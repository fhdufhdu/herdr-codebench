// node design/ade/check_frame_layout.mjs
// Pure native JSON/model checks. Actual splitter/focus/paint is checked by root.
import assert from 'node:assert/strict';
import { REGIONS, createFrameLayout, toggleRegion, selectTerminal, arrangeRegions, regionSettings, nativeTerminalContent, ensureDatabaseRegion, ensureFullWidthBottom, projectDimensions, restoreProjectDimensions } from '../../mods/ade/frame-layout.js';

const metrics = { appbarHeight: 48, statusHeight: 26, stripeWidth: 44, tabHeight: 40,
  tabFillHeight: 34, toolHeaderHeight: 36, rowHeight: 28, controlHeight: 28,
  leftWidth: 218, rightWidth: 244, lowerHeight: 180, radius: 4, splitterWidth: 6,
  iconSize: 16, stripeIconSize: 20 };
const clone = value => JSON.parse(JSON.stringify(value));
const nodes = tree => [tree, ...(tree.children ?? []).flatMap(nodes)];
const find = (tree, id) => nodes(tree).find(node => node.id === id);
const isHidden = node => node.hidden === true;
const deepFreeze = value => {
  if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); }
  return value;
};
const original = createFrameLayout(metrics), initial = clone(original);
deepFreeze(original);
const coreRegions = Object.keys(REGIONS).filter(key => !['database', 'review'].includes(key));
assert.deepEqual(Object.keys(REGIONS), ['project', 'structure', 'agents', 'terminal', 'results', 'database', 'review']);
assert.deepEqual(Object.values(REGIONS).map(region => region.label), ['프로젝트', '구조', '에이전트', '터미널', '실행 결과', '데이터베이스', '코드 리뷰']);
assert.deepEqual(REGIONS.results, { id: 'ade-results', label: '실행 결과', icon: 'play', side: 'bottom', section: 'bottom' });
assert.equal(nodes(original).length, 21); assert.equal(new Set(nodes(original).map(node => node.id)).size, 21);
assert.equal(original.resizable, false); assert.equal(original.movable, false); assert.equal(original.titlebar, 'none');
assert.deepEqual(original.traffic_lights, [12, 18]);
assert.deepEqual(find(original, 'ade-center').children.map(node => node.id), ['ade-editor']);
assert.deepEqual(find(original, 'ade-content').children.map(node => node.id), ['ade-upper', 'ade-results']);
assert.equal(find(original, 'ade-content').type, 'column');
assert.equal(find(original, 'ade-upper').type, 'row');
assert.deepEqual(find(original, 'ade-left').children.map(node => node.id), ['ade-project', 'ade-review', 'ade-structure']);
assert.deepEqual(find(original, 'ade-right').children.map(node => node.id), ['ade-agents', 'ade-database', 'ade-terminal']);
assert.equal(regionSettings(original).database.position, 'right-top', 'second same-slot child retains top section default');
assert.equal(find(original, 'ade-left').size.px, 218); assert.equal(find(original, 'ade-right').size.px, 244);
for (const id of ['ade-content', 'ade-left', 'ade-center', 'ade-right']) {
  const node = find(original, id); assert.equal(node.resizable, true); assert.deepEqual(node.divider, { width: 6, color: 'canvas' });
}
assert.equal(find(original, 'ade-workspace').resizable, false);
for (const [id, size] of [['ade-appbar', 48], ['ade-status', 26], ['ade-stripe-left', 44], ['ade-stripe-right', 44]]) {
  const node = find(original, id); assert.equal(node.min, size); assert.equal(node.max, size); assert.equal(node.size.px, size);
}
assert.equal(find(original, 'ade-appbar').window_drag, true);
assert.equal(find(original, 'ade-center').min, 320); assert.equal(find(original, 'ade-left').min, 120); assert.equal(find(original, 'ade-right').min, 120);
for (const [key, region] of Object.entries(REGIONS)) {
  const node = find(original, region.id);
  if (key === 'terminal') {
    assert.equal(node.type, 'column'); assert.equal(node.resizable, false);
    assert.deepEqual(node.children.map(child => child.id), ['ade-terminal-header', 'ade-terminal-body']);
    assert.deepEqual(node.children[0].content.props, { view: 'panel', region: key, headerOnly: true });
    assert.deepEqual(node.children[0].size, { px: 76 }); assert.equal(node.children[0].min, 76); assert.equal(node.children[0].max, 76);
    assert.deepEqual(node.children[1].content, nativeTerminalContent()); assert.equal(node.children[1].movable, true);
    assert.equal(node.children[1].content.pane.lone, true); assert.equal(node.children[1].content.pane.header.height, 28);
  } else { assert.equal(node.content.mod, 'ade'); assert.deepEqual(node.content.props, { view: 'panel', region: key }); }
  assert.equal(node.min, 84); assert.equal(node.radius, 4); assert.equal(isHidden(node), ['database', 'review'].includes(key));
  const toggled = toggleRegion(original, key); assert.notEqual(toggled, original);
  assert.equal(isHidden(find(toggled, region.id)), !['database', 'review'].includes(key)); assert.deepEqual(original, initial, 'frozen source remains unmodified');
  if (!['database', 'review'].includes(key)) assert.deepEqual(toggleRegion(toggled, key), initial, 'two toggles restore independent slots');
  else if (key === 'review') { assert.equal(find(toggled, 'ade-project').hidden, true); assert.equal(find(toggled, 'ade-structure').hidden, undefined); }
  else { assert.equal(find(toggled, 'ade-agents').hidden, true, 'database replaces agents in right-top slot'); assert.equal(find(toggled, 'ade-terminal').hidden, undefined); }
}

let frame = clone(initial);
frame.future = { layoutVersion: 2, keep: [false, null, 'value'] };
find(frame, 'ade-left').size = { px: 307 }; find(frame, 'ade-right').size = { px: 331 };
find(frame, 'ade-project').size = { weight: 2.25 }; find(frame, 'ade-structure').size = { px: 237 };
find(frame, 'ade-results').size = { px: 219 }; find(frame, 'ade-terminal').size = { px: 233 };
find(frame, 'ade-terminal-body').content = { terminal: 'untouched-terminal' };
find(frame, 'ade-terminal').terminalData = { id: 'untouched-terminal', output: 'existing output\n', cursor: [1, 4] };
find(frame, 'ade-content').children.push({ id: 'future-region', type: 'block', size: { px: 13 }, content: { terminal: 'native-terminal' } });
const customized = clone(frame);
frame = toggleRegion(frame, 'project'); assert.equal(isHidden(find(frame, 'ade-left')), false, 'one visible sibling keeps column open');
frame = toggleRegion(frame, 'structure'); assert.equal(isHidden(find(frame, 'ade-left')), true, 'last hidden child collapses its outer column');
frame = toggleRegion(frame, 'agents'); frame = toggleRegion(frame, 'terminal'); assert.equal(isHidden(find(frame, 'ade-right')), true);
frame = toggleRegion(frame, 'results'); assert.equal(isHidden(find(frame, 'ade-center')), false, 'editor center never collapses with results');
assert.equal(isHidden(find(frame, 'ade-editor')), false);
for (const key of Object.keys(REGIONS)) assert.equal(isHidden(find(frame, REGIONS[key].id)), true);
for (const key of coreRegions) frame = toggleRegion(frame, key);
assert.deepEqual(frame, customized, 'reopen restores all manual sizes and unrelated/terminal payloads');

// The host drops hidden:false. Both encodings must behave identically, with no
// render-time reconciliation, size reset, or false-vs-omitted toggle loop.
const hostRoundtrip = tree => {
  const copy = clone(tree); for (const node of nodes(copy)) if (node.hidden === false) delete node.hidden; return copy;
};
const explicit = clone(customized); for (const node of nodes(explicit)) node.hidden = false;
find(explicit, 'ade-database').hidden = true; find(explicit, 'ade-review').hidden = true;
for (const key of Object.keys(REGIONS)) assert.deepEqual(hostRoundtrip(toggleRegion(explicit, key)), hostRoundtrip(toggleRegion(hostRoundtrip(explicit), key)), 'false and omitted hidden flags have the same native result');

// Repeated user commands after host normalization preserve dimensions and data.
frame = hostRoundtrip(explicit);
for (let i = 0; i < 50; i++) {
  for (const key of coreRegions) frame = hostRoundtrip(toggleRegion(frame, key));
  for (const key of coreRegions) frame = hostRoundtrip(toggleRegion(frame, key));
}
assert.deepEqual(frame, customized);

const native = selectTerminal(toggleRegion(customized, 'terminal'), 'server/t42');
assert.deepEqual(find(native, 'ade-terminal-body').content, nativeTerminalContent());
assert.equal(isHidden(find(native, 'ade-terminal')), false);
assert.equal(isHidden(find(native, 'ade-right')), false);
assert.deepEqual(find(native, 'ade-terminal').size, { px: 233 });
assert.deepEqual(find(native, 'ade-terminal').terminalData, find(customized, 'ade-terminal').terminalData);
assert.deepEqual(find(native, 'ade-terminal-header'), find(customized, 'ade-terminal-header'));
assert.deepEqual(find(native, 'ade-left'), find(customized, 'ade-left'));
assert.deepEqual(find(native, 'ade-center'), find(customized, 'ade-center'));
assert.deepEqual(toggleRegion(toggleRegion(native, 'terminal'), 'terminal'), native, 'native terminal survives region toggles');
const activeTab = selectTerminal(native, null);
assert.deepEqual(find(activeTab, 'ade-terminal-body').content, nativeTerminalContent());
const customPaneFrame = clone(native); find(customPaneFrame, 'ade-terminal-body').content.pane.gap = 9;
assert.equal(find(selectTerminal(customPaneFrame, 'server/t-other'), 'ade-terminal-body').content.pane.gap, 9, 'tab selection preserves customized native pane framing');
for (const address of [undefined, '', ' ', {}, 42]) assert.equal(selectTerminal(original, address), original);
assert.equal(selectTerminal(null, 't1'), null);
assert.deepEqual(original, initial, 'terminal selection preserves frozen source');

const positions = { project: { position: 'right-bottom', order: 2, hidden: false }, structure: { position: 'bottom', order: 1, hidden: true },
  agents: { position: 'left-bottom', order: 0, hidden: false }, terminal: { position: 'left-top', order: 1, hidden: false }, results: { position: 'right-top', order: 0, hidden: false } };
const relocated = arrangeRegions(customized, positions);
assert.deepEqual(find(relocated, 'ade-left').children.map(node => node.id), ['ade-terminal', 'ade-review', 'ade-agents']);
assert.deepEqual(find(relocated, 'ade-right').children.map(node => node.id), ['ade-results', 'ade-database', 'ade-project']);
assert.deepEqual(find(relocated, 'ade-center').children.map(node => node.id), ['ade-editor']);
assert.equal(find(relocated, 'ade-content').children.at(-1).id, 'ade-structure');
assert.deepEqual(find(relocated, 'ade-terminal'), find(customized, 'ade-terminal'));
assert.deepEqual(find(relocated, 'future-region'), find(customized, 'future-region'));
assert.equal(regionSettings(relocated, positions).terminal.position, 'left-top');
assert.equal(find(toggleRegion(relocated, 'structure'), 'ade-structure').hidden, undefined);
const terminalHidden = toggleRegion(toggleRegion(relocated, 'terminal'), 'agents');
assert.equal(find(terminalHidden, 'ade-left').hidden, true);
assert.equal(find(selectTerminal(terminalHidden, 't-new'), 'ade-left').hidden, undefined, 'native selection opens relocated owner');
assert.equal(find(selectTerminal(terminalHidden, 't-new'), 'ade-right').hidden, undefined);
const allBottom = arrangeRegions(relocated, Object.fromEntries(Object.keys(REGIONS).map((key, order) => [key, { position: 'bottom', order, hidden: false }])));
assert.equal(find(allBottom, 'ade-left').hidden, true); assert.equal(find(allBottom, 'ade-right').hidden, true);
assert.equal(find(allBottom, 'ade-center').children[0].id, 'ade-editor');
assert.deepEqual(arrangeRegions(relocated, positions), relocated, 'repeated arrangement is stable');
for (const invalid of [{ project: { position: 'floating' } }, { project: { hidden: 'yes' } }, { terminal: { order: NaN } }]) assert.equal(arrangeRegions(customized, invalid), customized);
assert.deepEqual(frame, customized, 'region relocation never mutates input');
const legacy = clone(customized); find(legacy, 'ade-right').children = find(legacy, 'ade-right').children.filter(node => node.id !== 'ade-database');
assert.notEqual(toggleRegion(legacy, 'project'), legacy, 'legacy frame without database remains valid');
assert.equal(regionSettings(legacy).database.hidden, true);
const migrated = ensureDatabaseRegion(legacy);
assert.deepEqual(find(migrated, 'ade-terminal'), find(legacy, 'ade-terminal'));
assert.deepEqual(find(migrated, 'ade-left'), find(legacy, 'ade-left'));
assert.deepEqual(find(migrated, 'ade-right').size, find(legacy, 'ade-right').size);
assert.equal(find(migrated, 'ade-database').hidden, true);
assert.equal(ensureDatabaseRegion(migrated), migrated, 'migration is idempotent');
const legacyDBOpen = toggleRegion(legacy, 'database'); assert.equal(find(legacyDBOpen, 'ade-database').hidden, undefined); assert.equal(find(legacyDBOpen, 'ade-agents').hidden, true);
// Regression: an older installer appended DB after the native bottom terminal.
// Showing DB must repair physical JSON order, not only stripe metadata.
const appendedDB = clone(customized), right = find(appendedDB, 'ade-right');
right.children = [find(appendedDB, 'ade-agents'), { id: 'right-unknown', type: 'block', size: { px: 17 }, content: { terminal: 'keep-this-process' } }, find(appendedDB, 'ade-terminal'), find(appendedDB, 'ade-database')];
const visibleTools = (tree, side) => find(tree, `ade-${side}`).children.filter(node => Object.values(REGIONS).some(region => region.id === node.id) && node.hidden !== true).map(node => node.id);
const physicalDBOpen = toggleRegion(appendedDB, 'database');
assert.deepEqual(visibleTools(physicalDBOpen, 'right'), ['ade-database', 'ade-terminal'], 'database is physically above terminal');
assert.deepEqual(find(physicalDBOpen, 'ade-terminal'), find(appendedDB, 'ade-terminal'), 'native pane/process/manual terminal size untouched');
assert.deepEqual(find(physicalDBOpen, 'ade-left'), find(appendedDB, 'ade-left'));
assert.deepEqual(find(physicalDBOpen, 'ade-center'), find(appendedDB, 'ade-center'));
assert.deepEqual(find(physicalDBOpen, 'ade-right').size, find(appendedDB, 'ade-right').size);
assert.deepEqual(find(physicalDBOpen, 'ade-right').children[1], right.children[1], 'unrelated child retains index/data');
const physicalAgentsOpen = toggleRegion(physicalDBOpen, 'agents');
assert.deepEqual(visibleTools(physicalAgentsOpen, 'right'), ['ade-agents', 'ade-terminal'], 'switching right-top keeps terminal right-bottom');
assert.deepEqual(find(physicalAgentsOpen, 'ade-terminal'), find(appendedDB, 'ade-terminal'));
assert.deepEqual(ensureDatabaseRegion(appendedDB), (() => { const fixed = clone(appendedDB); const children = find(fixed, 'ade-right').children; [children[2], children[3]] = [children[3], children[2]]; return fixed; })(), 'migration repairs an already-present appended database');
const sectionOverrides = { agents: { position: 'right-bottom' }, database: { position: 'right-top' }, terminal: { position: 'right-bottom' } };
const explicitSlots = toggleRegion(appendedDB, 'database', sectionOverrides);
assert.deepEqual(find(explicitSlots, 'ade-right').children.filter(node => node.id !== 'right-unknown').map(node => node.id), ['ade-database', 'ade-agents', 'ade-terminal'], 'explicit slot sections determine native order');
assert.equal(regionSettings(explicitSlots, sectionOverrides).database.position, 'right-top');
const missingWithTarget = ensureDatabaseRegion(legacy, { database: { position: 'left-top', order: 0 } });
assert.equal(find(missingWithTarget, 'ade-left').children.some(node => node.id === 'ade-database'), true, 'missing DB honors explicit native target parent');
assert.equal(find(missingWithTarget, 'ade-right').children.some(node => node.id === 'ade-database'), false);
const fiveSlots = { project: { position: 'left-top', hidden: false, order: 0 }, structure: { position: 'left-bottom', hidden: false, order: 0 },
  database: { position: 'right-top', hidden: false, order: 0 }, terminal: { position: 'right-bottom', hidden: false, order: 0 },
  results: { position: 'bottom', hidden: false, order: 0 }, agents: { position: 'right-top', hidden: true, order: 1 } };
const fivePhysical = arrangeRegions(appendedDB, fiveSlots);
assert.deepEqual(visibleTools(fivePhysical, 'left'), ['ade-project', 'ade-structure']);
assert.deepEqual(visibleTools(fivePhysical, 'right'), ['ade-database', 'ade-terminal']);
assert.deepEqual(find(fivePhysical, 'ade-center').children.map(node => node.id), ['ade-editor']);
assert.equal(find(fivePhysical, 'ade-content').children.filter(node => node.id === 'ade-results').length, 1);
assert.deepEqual(Object.fromEntries(Object.entries(regionSettings(fivePhysical, fiveSlots)).filter(([key]) => !['agents', 'review'].includes(key)).map(([key, value]) => [key, value.position])), { project: 'left-top', structure: 'left-bottom', terminal: 'right-bottom', results: 'bottom', database: 'right-top' });
const dbBottom = arrangeRegions(initial, { database: { position: 'bottom', hidden: true } });
const dbBottomOpen = toggleRegion(dbBottom, 'database', { database: { position: 'bottom' } });
assert.equal(find(dbBottomOpen, 'ade-results').hidden, true, 'same bottom slot switches active tool');
assert.equal(find(dbBottomOpen, 'ade-terminal').hidden, undefined, 'different slot remains visible');
assert.equal(find(dbBottomOpen, 'ade-editor').hidden, undefined);
const customSlots = { terminal: { position: 'right-top', hidden: false }, database: { position: 'right-bottom', hidden: false }, agents: { hidden: true } };
const splitSizes = clone(customized); find(splitSizes, 'ade-terminal').max = 777; find(splitSizes, 'ade-database').size = { px: 271 };
const splitTools = arrangeRegions(splitSizes, customSlots), onlyTerminal = toggleRegion(splitTools, 'database', customSlots);
assert.deepEqual(visibleTools(onlyTerminal, 'right'), ['ade-terminal']);
assert.deepEqual(find(onlyTerminal, 'ade-terminal').size, { weight: 1 }, 'single fixed-px terminal fills its side');
assert.equal(find(onlyTerminal, 'ade-terminal').max, undefined, 'old split max does not cap a solitary tool');
assert.deepEqual(find(onlyTerminal, 'ade-terminal-header').content.props.adeSoloSizing, { size: { px: 233 }, max: 777 });
assert.deepEqual(find(onlyTerminal, 'ade-terminal-body'), find(splitTools, 'ade-terminal-body'), 'fill preserves the complete native content');
assert.equal(regionSettings(onlyTerminal, customSlots).terminal.position, 'right-top');
assert.equal(regionSettings(onlyTerminal, customSlots).database.position, 'right-bottom');
assert.equal(ensureDatabaseRegion(onlyTerminal, customSlots), onlyTerminal, 'already-filled geometry is idempotent');
assert.deepEqual(toggleRegion(hostRoundtrip(onlyTerminal), 'database', customSlots), splitTools, 'reopening the second tool restores exact manual split sizes/max after serialized props roundtrip');
const onlyDatabase = toggleRegion(splitTools, 'terminal', customSlots);
assert.deepEqual(find(onlyDatabase, 'ade-database').size, { weight: 1 }, 'single database fills even in bottom side slot');
assert.deepEqual(toggleRegion(onlyDatabase, 'terminal', customSlots), splitTools, 'opening terminal restores database split size');
const withUnknown = clone(splitTools); find(withUnknown, 'ade-right').children.push({ id: 'visible-unknown', type: 'block', size: { px: 61 }, content: { terminal: 'preserve' } });
const keptSplit = toggleRegion(withUnknown, 'database', customSlots);
assert.deepEqual(find(keptSplit, 'ade-terminal').size, { px: 233 }, 'visible unknown child prevents solitary fill from consuming its space');
assert.equal(find(keptSplit, 'ade-terminal').max, 777); assert.equal(find(keptSplit, 'visible-unknown').size.px, 61);
const onlyLeft = toggleRegion(customized, 'project');
assert.deepEqual(find(onlyLeft, 'ade-structure').size, { weight: 1 }, 'left side follows same solitary fill rule');
assert.deepEqual(toggleRegion(onlyLeft, 'project'), customized);
const futureChild = clone(initial); find(futureChild, 'ade-left').children.push({ id: 'future-terminal', type: 'block', content: { terminal: 'keep-visible' } });
assert.equal(isHidden(find(toggleRegion(toggleRegion(futureChild, 'project'), 'structure'), 'ade-left')), false, 'a future visible child is not hidden with the known slots');

const rejected = [null, {}, { id: 'root', type: 'column' }, { id: 'ade-root', type: 'column', children: {} }, clone(initial), clone(initial), clone(initial)];
find(rejected[4], 'ade-project').content.mod = 'other';
find(rejected[5], 'ade-center').children = [];
find(rejected[6], 'ade-left').children.push(clone(find(rejected[6], 'ade-project')));
for (const tree of rejected) assert.equal(toggleRegion(tree, 'project'), tree, 'invalid or replaced layouts are untouched');
for (const key of ['unknown', '__proto__', 'toString', null]) assert.equal(toggleRegion(original, key), original);
assert.deepEqual(createFrameLayout(metrics), initial, 'builders share no mutable tree state');
for (const value of [undefined, 0, -1, Infinity, NaN, '48']) assert.throws(() => createFrameLayout({ ...metrics, appbarHeight: value }), /metric/);
const enlarged = createFrameLayout({ ...metrics, appbarHeight: 56, stripeWidth: 52, splitterWidth: 8 });
assert.equal(find(enlarged, 'ade-appbar').size.px, 56); assert.equal(find(enlarged, 'ade-stripe-left').max, 52); assert.equal(find(enlarged, 'ade-content').divider.width, 8);
console.log('PASS ADE frame: seven tools/five slots, physical slot order, solitary side fill/exact split restoration, hidden DB/legacy migration, native pane/manual size/unknown preservation and invalid-layout guards');

const sizeA = projectDimensions(original), projectB = clone(original);
find(projectB, 'ade-left').size = { px: 310 };
find(projectB, 'ade-right').size = { px: 440 };
find(projectB, 'ade-results').size = { px: 260 };
const sizeB = projectDimensions(projectB);
const restoredA = restoreProjectDimensions(projectB, sizeA);
assert.equal(find(restoredA, 'ade-left').size.px, 218);
assert.equal(find(restoredA, 'ade-right').size.px, 244);
const restoredB = restoreProjectDimensions(restoredA, sizeB);
assert.equal(find(restoredB, 'ade-left').size.px, 310);
assert.equal(find(restoredB, 'ade-results').size.px, 260);
assert.equal(find(restoredB, 'ade-terminal-body').content.tab, 'active');
assert.deepEqual(original, initial);
assert.equal(restoreProjectDimensions({ id: 'other' }, sizeA).id, 'other');
console.log('PASS project dimensions: separate widths/heights, immutable restoration and live terminal preservation');

const narrow = clone(initial), narrowContent = find(narrow, 'ade-content'), oldUpper = find(narrow, 'ade-upper');
const oldBottom = narrowContent.children.filter(node => node.id !== 'ade-upper');
find(narrow, 'ade-center').children.push(...oldBottom);
narrowContent.type = 'row'; narrowContent.children = oldUpper.children;
const legacyBottom = clone(narrow);
const widened = ensureFullWidthBottom(narrow);
assert.equal(find(widened, 'ade-content').type, 'column');
assert.deepEqual(find(widened, 'ade-center').children.map(node => node.id), ['ade-editor']);
assert.deepEqual(find(widened, 'ade-results'), find(narrow, 'ade-results'));
assert.deepEqual(find(widened, 'ade-terminal-body'), find(narrow, 'ade-terminal-body'));
assert.deepEqual(narrow, legacyBottom);
assert.equal(ensureFullWidthBottom(widened), widened);
assert.equal(regionSettings(widened).results.position, 'bottom');
assert.deepEqual(find(toggleRegion(narrow, 'project'), 'ade-content').children.map(node => node.id), ['ade-upper', 'ade-results']);
console.log('PASS full-width bottom: native split, all five slots, old narrow-layout migration, dimensions and terminal payload preservation');

const perProject = { alpha: projectDimensions(initial), beta: projectDimensions(customized) };
const alphaFrame = restoreProjectDimensions(customized, perProject.alpha);
const betaFrame = restoreProjectDimensions(alphaFrame, perProject.beta);
for (const id of ['ade-left', 'ade-right', 'ade-results', 'ade-structure', 'ade-terminal']) {
  assert.deepEqual(find(betaFrame, id).size, find(customized, id).size, `${id} keeps its project-specific size`);
}
assert.deepEqual(projectDimensions(alphaFrame), perProject.alpha);
assert.deepEqual(find(betaFrame, 'ade-terminal-body').content, find(customized, 'ade-terminal-body').content);
console.log('PASS project tool sizes: independent side widths, structure/terminal heights and full-width bottom height');

const beforeReview = clone(initial);
find(beforeReview, 'ade-left').children = find(beforeReview, 'ade-left').children.filter(node => node.id !== 'ade-review');
const reviewMigrated = ensureDatabaseRegion(beforeReview);
assert.equal(find(reviewMigrated, 'ade-review').hidden, true);
assert.deepEqual(find(reviewMigrated, 'ade-terminal-body'), find(beforeReview, 'ade-terminal-body'));
const reviewOpened = toggleRegion(reviewMigrated, 'review');
assert.equal(find(reviewOpened, 'ade-review').hidden, undefined);
assert.equal(find(reviewOpened, 'ade-project').hidden, true);
assert.equal(find(reviewOpened, 'ade-structure').hidden, undefined);
const projectOpened = toggleRegion(reviewOpened, 'project');
assert.equal(find(projectOpened, 'ade-review').hidden, true);
assert.equal(find(projectOpened, 'ade-project').hidden, undefined);
console.log('PASS review tool: left-top switch, sidebar size/visibility, legacy migration and native terminal preservation');
