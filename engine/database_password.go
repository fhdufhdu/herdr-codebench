package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

// Exclusively owned by database profiles. Never enumerate the keychain.
const databasePasswordService = "dev.herdr.codebench.database"
const databasePasswordPrefix = "herdr-db-v1:"

var errDatabasePasswordNotFound = errors.New("database Keychain credential missing; enter the password and save again")

type databasePasswordStore interface {
	Get(context.Context, string) (string, error)
	Set(context.Context, string, string) error
	Delete(context.Context, string) error
}

var newDatabasePasswordStore = func() databasePasswordStore {
	if runtime.GOOS == "darwin" {
		return securityDatabasePasswordStore{}
	}
	return nil
}

type securityDatabasePasswordStore struct{}

func databasePasswordAccount(id string) bool {
	if len(id) != 32 {
		return false
	}
	for _, c := range id {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return false
		}
	}
	return true
}

func databasePasswordCommand(id, password string) (string, error) {
	if !databasePasswordAccount(id) {
		return "", errors.New("invalid database credential account")
	}
	// Base64 preserves newlines, quotes and NUL through security's line parser.
	payload := databasePasswordPrefix + base64.StdEncoding.EncodeToString([]byte(password))
	command := "add-generic-password -U -s " + databasePasswordService + " -a " + id + " -w " + payload + "\n"
	if len(command) >= 4096 {
		return "", errors.New("database password exceeds Keychain command size limit")
	}
	return command, nil
}

func databaseSecurityRun(ctx context.Context, input string, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "/usr/bin/security", args...)
	if input != "" {
		cmd.Stdin = strings.NewReader(input)
	}
	var output bytes.Buffer
	cmd.Stdout = &output
	// Never expose subprocess diagnostics, which may contain sensitive data.
	if err := cmd.Run(); err != nil {
		var exit *exec.ExitError
		// errSecItemNotFound (-25300), returned by security as an exit status.
		if errors.As(err, &exit) && exit.ExitCode() == 44 {
			return nil, errDatabasePasswordNotFound
		}
		return nil, errors.New("database Keychain operation failed; unlock Keychain and retry")
	}
	return output.Bytes(), nil
}
func (securityDatabasePasswordStore) Set(ctx context.Context, id, password string) error {
	command, err := databasePasswordCommand(id, password)
	if err != nil {
		return err
	}
	_, err = databaseSecurityRun(ctx, command, "-i", "-q")
	return err
}
func (securityDatabasePasswordStore) Get(ctx context.Context, id string) (string, error) {
	if !databasePasswordAccount(id) {
		return "", errors.New("invalid database credential account")
	}
	b, err := databaseSecurityRun(ctx, "", "find-generic-password", "-s", databasePasswordService, "-a", id, "-w")
	if err != nil {
		return "", err
	}
	payload := strings.TrimSuffix(string(b), "\n")
	if !strings.HasPrefix(payload, databasePasswordPrefix) {
		return "", errors.New("invalid database Keychain credential format")
	}
	decoded, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(payload, databasePasswordPrefix))
	if err != nil {
		return "", errors.New("invalid database Keychain credential format")
	}
	return string(decoded), nil
}
func (securityDatabasePasswordStore) Delete(ctx context.Context, id string) error {
	if !databasePasswordAccount(id) {
		return errors.New("invalid database credential account")
	}
	_, err := databaseSecurityRun(ctx, "", "delete-generic-password", "-s", databasePasswordService, "-a", id)
	if errors.Is(err, errDatabasePasswordNotFound) {
		return nil
	}
	return err
}

// Keychain and metadata are separate durable stores. Restore the credential if
// metadata commit fails; report explicitly if that compensation also fails.
func (m *databaseManager) changePasswordLocked(ctx context.Context, old dbSource, next *dbSource, password *string, commit func() error) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	commitMetadata := func() error {
		if err := ctx.Err(); err != nil {
			return err
		}
		return commit()
	}
	if password == nil && m.passwordStore != nil && m.passwords[next.ID] != "" {
		pw := m.passwords[next.ID]
		password = &pw
	}
	if password == nil {
		return commitMetadata()
	}
	had := old.HasPassword && old.PasswordStorage == "keychain"
	if m.passwordStore == nil {
		if had {
			return errors.New("database password requires macOS Keychain")
		}
		next.HasPassword, next.PasswordStorage = false, "none"
		return commitMetadata()
	}
	previous := ""
	if had {
		var err error
		previous, err = m.passwordStore.Get(ctx, next.ID)
		if errors.Is(err, errDatabasePasswordNotFound) {
			had = false // An externally removed item can be explicitly replaced/cleared.
		} else if err != nil {
			return err
		}
	}
	if *password != "" {
		if err := m.passwordStore.Set(ctx, next.ID, *password); err != nil {
			return err
		}
	} else if had {
		if err := m.passwordStore.Delete(ctx, next.ID); err != nil {
			return err
		}
	}
	next.HasPassword, next.PasswordStorage = *password != "", "none"
	if next.HasPassword {
		next.PasswordStorage = "keychain"
	}
	if err := commitMetadata(); err != nil {
		// Compensation must outlive a cancelled request, but remains bounded by the store.
		var rollback error
		if had {
			rollback = m.passwordStore.Set(m.ctx, next.ID, previous)
		} else if *password != "" {
			rollback = m.passwordStore.Delete(m.ctx, next.ID)
		}
		if rollback != nil {
			return errors.New("database metadata save failed and Keychain rollback failed; re-enter the password and save again")
		}
		return err
	}
	return nil
}
