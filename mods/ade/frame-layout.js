// ADE frame structure only. Native layout owns visibility and panel sizes.
// This module has no runtime imports and never reads or writes product state.
export const REGIONS = Object.freeze(Object.fromEntries([
  ['project', '프로젝트', 'file-text', 'left', 'top'],
  ['structure', '구조', 'list-tree', 'left', 'bottom'],
  ['agents', '에이전트', 'bot', 'right', 'top'],
  ['terminal', '터미널', 'terminal', 'right', 'bottom'],
  ['results', '실행 결과', 'play', 'bottom', 'bottom'],
  ['database', '데이터베이스', 'database', 'right', 'top'],
  ['review', '코드 리뷰', 'git-branch', 'left', 'top'],
].map(([key, label, icon, side, section]) => [key, Object.freeze({ id: `ade-${key}`, label, icon, side, section })])));

const block = (id, view, size, extra = {}) => ({
  id, type: 'block', ...(size ? { size } : {}), background: 'canvas',
  content: { mod: 'ade', props: { view, ...extra } },
});
export function nativeTerminalContent({ radius = 4, gap = 6 } = {}) {
  return { tab: 'active', pane: { lone: true, radius, gap, background: 'background',
    border: { width: 1, color: 'border' }, focus: { width: 1, color: 'accent' },
    header: { content: { mod: 'ade', props: { view: 'pane-header' } }, height: 28, position: 'top', reveal: 'always' },
  } };
}
export function createFrameLayout(metrics) {
  for (const key of ['appbarHeight', 'statusHeight', 'stripeWidth', 'leftWidth', 'rightWidth', 'lowerHeight', 'radius', 'splitterWidth', 'toolHeaderHeight', 'tabHeight']) {
    if (!Number.isFinite(metrics?.[key]) || metrics[key] <= 0) throw new RangeError(`Invalid ADE metric: ${key}`);
  }
  const split = (id, type, size, children) => ({
    id, type, size, background: 'canvas', resizable: true,
    divider: { width: metrics.splitterWidth, color: 'canvas' }, children,
  });
  const panel = (key, size) => key === 'terminal' ? {
    id: REGIONS.terminal.id, type: 'column', size, min: 84, radius: metrics.radius, background: 'canvas', resizable: false,
    children: [
      { ...block('ade-terminal-header', 'panel', { px: metrics.toolHeaderHeight + metrics.tabHeight }, { region: 'terminal', headerOnly: true }), min: metrics.toolHeaderHeight + metrics.tabHeight, max: metrics.toolHeaderHeight + metrics.tabHeight },
      { id: 'ade-terminal-body', type: 'block', size: { weight: 1 }, movable: true, content: nativeTerminalContent({ radius: metrics.radius, gap: metrics.splitterWidth }) },
    ],
  } : ({ ...block(REGIONS[key].id, 'panel', size, { region: key }), min: 84, radius: metrics.radius });
  const editor = block('ade-editor', 'editor', { weight: 1 });
  editor.min = 84;
  editor.radius = metrics.radius;
  return {
    id: 'ade-root', type: 'column', background: 'canvas', resizable: false, movable: false,
    titlebar: 'none', traffic_lights: [12, 18], ui_font: '.AppleSystemUIFont',
    children: [
      { ...block('ade-appbar', 'appbar', { px: metrics.appbarHeight }), min: metrics.appbarHeight, max: metrics.appbarHeight, window_drag: true },
      {
        id: 'ade-workspace', type: 'row', size: { weight: 1 }, background: 'canvas', resizable: false,
        children: [
          { ...block('ade-stripe-left', 'stripe', { px: metrics.stripeWidth }, { side: 'left' }), min: metrics.stripeWidth, max: metrics.stripeWidth },
          split('ade-content', 'column', { weight: 1 }, [
            split('ade-upper', 'row', { weight: 1 }, [
            { ...split('ade-left', 'column', { px: metrics.leftWidth }, [panel('project', { weight: 1 }), { ...panel('review', { weight: 1 }), hidden: true }, panel('structure', { px: metrics.lowerHeight })]), min: 120 },
            { ...split('ade-center', 'column', { weight: 1 }, [editor]), min: 320 },
            { ...split('ade-right', 'column', { px: metrics.rightWidth }, [panel('agents', { weight: 1 }), { ...panel('database', { weight: 1 }), hidden: true }, panel('terminal', { px: metrics.lowerHeight })]), min: 120 },
            ]),
            panel('results', { px: metrics.lowerHeight }),
          ]),
          { ...block('ade-stripe-right', 'stripe', { px: metrics.stripeWidth }, { side: 'right' }), min: metrics.stripeWidth, max: metrics.stripeWidth },
        ],
      },
      { ...block('ade-status', 'status', { px: metrics.statusHeight }), min: metrics.statusHeight, max: metrics.statusHeight },
    ],
  };
}

const child = (node, id, type) => {
  const matches = Array.isArray(node?.children) ? node.children.filter(node => node?.id === id) : [];
  return matches.length === 1 && matches[0].type === type ? matches[0] : undefined;
};
const viewIs = (node, view) => node?.content?.mod === 'ade' && node.content.props?.view === view;
const visible = node => node.hidden !== true;
const hidden = (node, value) => { if (value) node.hidden = true; else delete node.hidden; };

// Reject another layout or a partial/replaced ADE shell. Do not reconstruct it
// or restore default sizes when a toggle arrives after the active layout changed.
function frameNodes(tree) {
  if (tree?.id !== 'ade-root' || tree.type !== 'column') return null;
  const workspace = child(tree, 'ade-workspace', 'row');
  const content = child(workspace, 'ade-content', 'column') ?? child(workspace, 'ade-content', 'row');
  const upper = content?.type === 'column' ? child(content, 'ade-upper', 'row') : content;
  const nodes = { left: child(upper, 'ade-left', 'column'), center: child(upper, 'ade-center', 'column'), right: child(upper, 'ade-right', 'column') };
  nodes.bottom = content?.type === 'column' ? content : nodes.center;
  if (!viewIs(child(tree, 'ade-appbar', 'block'), 'appbar') || !viewIs(child(tree, 'ade-status', 'block'), 'status') || !viewIs(child(nodes.center, 'ade-editor', 'block'), 'editor')) return null;
  for (const side of ['left', 'right']) {
    const stripe = child(workspace, `ade-stripe-${side}`, 'block');
    if (!viewIs(stripe, 'stripe') || stripe.content.props.side !== side || !nodes[side]) return null;
  }
  for (const [key, region] of Object.entries(REGIONS)) {
    const parents = ['left', 'bottom', 'right'].filter(side => nodes[side]?.children?.some(node => node.id === region.id));
    if (!parents.length && ['database', 'review'].includes(key)) continue; // Pre-database ADE shells remain valid.
    if (parents.length !== 1) return null;
    const parent = nodes[parents[0]], node = child(parent, region.id, key === 'terminal' ? 'column' : 'block');
    if (key === 'terminal') {
      const header = child(node, 'ade-terminal-header', 'block'), body = child(node, 'ade-terminal-body', 'block');
      if (!viewIs(header, 'panel') || header.content.props.region !== key || header.content.props.headerOnly !== true || !body) return null;
      if (body.content?.tab !== 'active' && !viewIs(body, 'terminal-body') && !(typeof body.content?.terminal === 'string' && body.content.terminal.length > 0)) return null;
      nodes.terminalBody = body;
    } else if (!viewIs(node, 'panel') || node.content.props.region !== key) return null;
    nodes[key] = node;
    nodes.parents ??= {}; nodes.parents[key] = parents[0];
  }
  return nodes;
}

export function ensureFullWidthBottom(tree) {
  const nodes = frameNodes(tree);
  if (!nodes || nodes.bottom.id === 'ade-content') return tree;
  const next = JSON.parse(JSON.stringify(tree));
  const workspace = child(next, 'ade-workspace', 'row'), content = child(workspace, 'ade-content', 'row');
  const center = child(content, 'ade-center', 'column');
  const owned = new Set(Object.values(REGIONS).map(region => region.id));
  const bottom = center.children.filter(node => owned.has(node.id));
  center.children = center.children.filter(node => !owned.has(node.id));
  const upper = { id: 'ade-upper', type: 'row', size: { weight: 1 }, background: content.background, resizable: content.resizable,
    ...(content.divider ? { divider: content.divider } : {}), children: content.children };
  content.type = 'column'; content.children = [upper, ...bottom];
  return next;
}

export function ensureDatabaseRegion(tree, metadata = {}) {
  const nodes = frameNodes(tree); if (!nodes) return tree;
  const next = JSON.parse(JSON.stringify(ensureFullWidthBottom(tree))), copy = frameNodes(next);
  if (!copy.database) {
    const position = POSITIONS.includes(metadata?.database?.position) ? metadata.database.position : 'right-top';
    const side = position === 'bottom' ? 'bottom' : position.split('-')[0];
    copy[side].children.push({
      ...block(REGIONS.database.id, 'panel', { weight: 1 }, { region: 'database' }), min: 84, radius: copy.agents.radius ?? 4, hidden: true,
    });
  }
  if (!copy.review) {
    const position = POSITIONS.includes(metadata?.review?.position) ? metadata.review.position : 'left-top';
    const side = position === 'bottom' ? 'bottom' : position.split('-')[0];
    copy[side].children.push({ ...block(REGIONS.review.id, 'panel', { weight: 1 }, { region: 'review' }), min: 84, radius: copy.project.radius ?? 4, hidden: true });
  }
  const arranged = frameNodes(next); orderKnownChildren(arranged, metadata); updateColumns(arranged);
  return JSON.stringify(next) === JSON.stringify(tree) ? tree : next;
}
// Slots must be represented by native sibling order, including hidden tools.
// Replacing only known child slots leaves unrelated children in their places.
function orderKnownChildren(nodes, metadata = {}) {
  const positions = regionSettingsFromNodes(nodes, metadata), byId = new Map(Object.entries(REGIONS).map(([key, region]) => [region.id, key]));
  for (const side of ['left', 'bottom', 'right']) {
    const children = nodes[side].children, known = children.filter(node => byId.has(node.id));
    known.sort((a, b) => {
      const keyA = byId.get(a.id), keyB = byId.get(b.id);
      return Number(positions[keyA].position.endsWith('-bottom')) - Number(positions[keyB].position.endsWith('-bottom'))
        || (Number.isFinite(metadata?.[keyA]?.order) ? metadata[keyA].order : positions[keyA].order)
          - (Number.isFinite(metadata?.[keyB]?.order) ? metadata[keyB].order : positions[keyB].order);
    });
    const editor = children.findIndex(node => node.id === 'ade-editor');
    if (side === 'bottom' && children.some((node, index) => byId.has(node.id) && index < editor)) {
      nodes[side].children = [...children.filter(node => !byId.has(node.id)), ...known];
    } else {
      let at = 0; nodes[side].children = children.map(node => byId.has(node.id) ? known[at++] : node);
    }
  }
}
function openOnly(nodes, key, metadata) {
  const positions = regionSettingsFromNodes(nodes, metadata), position = positions[key].position;
  for (const other of Object.keys(REGIONS)) if (other !== key && nodes[other] && positions[other].position === position) hidden(nodes[other], true);
  hidden(nodes[key], false);
}
function updateColumns(nodes) {
  // Keep the last split dimensions in a supported, ADE-owned mod props field.
  // Arbitrary layout-node fields are not preserved by native serialization.
  for (const key of Object.keys(REGIONS)) {
    const node = nodes[key]; if (!node) continue;
    const owner = key === 'terminal' ? child(node, 'ade-terminal-header', 'block') : node;
    const saved = owner.content.props.adeSoloSizing;
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) continue;
    if (Object.hasOwn(saved, 'size')) node.size = saved.size; else delete node.size;
    if (Object.hasOwn(saved, 'max')) node.max = saved.max; else delete node.max;
    delete owner.content.props.adeSoloSizing;
  }
  for (const side of ['left', 'right']) {
    const shown = nodes[side].children.filter(visible);
    if (shown.length !== 1) continue;
    const node = shown[0], key = Object.keys(REGIONS).find(key => nodes[key] === node);
    if (!key || !(Number.isFinite(node.size?.px) || Number.isFinite(node.max))) continue;
    const owner = key === 'terminal' ? child(node, 'ade-terminal-header', 'block') : node;
    owner.content.props.adeSoloSizing = {
      ...(Object.hasOwn(node, 'size') ? { size: node.size } : {}),
      ...(Object.hasOwn(node, 'max') ? { max: node.max } : {}),
    };
    node.size = { weight: 1 }; delete node.max;
  }
  for (const side of ['left', 'right']) hidden(nodes[side], nodes[side].children.every(node => !visible(node)));
}
export function toggleRegion(tree, key, metadata = {}) {
  if (!Object.hasOwn(REGIONS, key) || !frameNodes(tree)) return tree;
  const source = ['database', 'review'].includes(key) ? ensureDatabaseRegion(tree, metadata) : ensureFullWidthBottom(tree);
  const next = JSON.parse(JSON.stringify(source)), nodes = frameNodes(next);
  if (visible(nodes[key])) hidden(nodes[key], true); else openOnly(nodes, key, metadata);
  orderKnownChildren(nodes, metadata); updateColumns(nodes);
  return next;
}

// Runtime owners select the core tab first. This composition always shows its
// full native pane tree; an address never replaces that tree with one terminal.
export function selectTerminal(tree, address, metadata = {}) {
  if (!frameNodes(tree) || (address !== null && (typeof address !== 'string' || !address.trim()))) return tree;
  const next = JSON.parse(JSON.stringify(ensureFullWidthBottom(tree))), nodes = frameNodes(next);
  if (nodes.terminalBody.content?.tab !== 'active') nodes.terminalBody.content = nativeTerminalContent();
  nodes.terminalBody.movable = true;
  const header = child(nodes.terminal, 'ade-terminal-header', 'block');
  if ((header.size?.px ?? 0) < 76) { header.size = { px: 76 }; header.min = 76; header.max = 76; }
  openOnly(nodes, 'terminal', metadata); orderKnownChildren(nodes, metadata); updateColumns(nodes);
  return next;
}

const POSITIONS = ['left-top', 'left-bottom', 'right-top', 'right-bottom', 'bottom'];
export function regionSettings(tree, metadata = {}) {
  const nodes = frameNodes(tree); if (!nodes) return null;
  return regionSettingsFromNodes(nodes, metadata);
}
function regionSettingsFromNodes(nodes, metadata = {}) {
  return Object.fromEntries(Object.entries(REGIONS).map(([key, region]) => {
    if (!nodes[key]) return [key, { position: POSITIONS.includes(metadata?.[key]?.position) ? metadata[key].position : `${region.side}-${region.section}`, order: 1, hidden: true }];
    const side = nodes.parents[key], hint = metadata?.[key]?.position;
    const position = side === 'bottom' ? 'bottom' : POSITIONS.includes(hint) && hint.startsWith(`${side}-`) ? hint : `${side}-${region.section}`;
    return [key, { position, order: nodes[side].children.indexOf(nodes[key]), hidden: !visible(nodes[key]) }];
  }));
}
export function arrangeRegions(tree, settings = {}) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings) || !Object.keys(REGIONS).some(key => settings[key] !== undefined)) return tree;
  const existing = regionSettings(tree, settings); if (!existing) return tree;
  for (const key of Object.keys(REGIONS)) {
    const value = settings[key];
    if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value)
      || (value.position !== undefined && !POSITIONS.includes(value.position))
      || (value.order !== undefined && !Number.isFinite(value.order))
      || (value.hidden !== undefined && typeof value.hidden !== 'boolean'))) return tree;
  }
  const source = settings.database || settings.review ? ensureDatabaseRegion(tree, settings) : ensureFullWidthBottom(tree);
  const next = JSON.parse(JSON.stringify(source)), nodes = frameNodes(next), owned = new Set(Object.values(REGIONS).map(region => region.id));
  const effective = Object.fromEntries(Object.keys(REGIONS).map(key => [key, { ...existing[key], ...settings[key] }]));
  for (const side of ['left', 'bottom', 'right']) {
    const unknown = nodes[side].children.filter(node => !owned.has(node.id));
    const known = Object.keys(REGIONS).filter(key => nodes[key] && (effective[key].position === 'bottom' ? side === 'bottom' : effective[key].position.startsWith(`${side}-`)));
    known.sort((a, b) => Number(effective[a].position.endsWith('-bottom')) - Number(effective[b].position.endsWith('-bottom')) || effective[a].order - effective[b].order);
    const active = new Set();
    for (const key of known) {
      hidden(nodes[key], effective[key].hidden || active.has(effective[key].position));
      if (visible(nodes[key])) active.add(effective[key].position);
    }
    nodes[side].children = [...unknown, ...known.map(key => nodes[key])];
  }
  updateColumns(nodes);
  return next;
}

// Save dimensions only. Tool placement, visibility and live terminals stay live.
export function projectDimensions(tree) {
  const nodes = frameNodes(tree);
  if (!nodes) return {};
  const sizes = {};
  for (const key of ['left', 'right', ...Object.keys(REGIONS)]) {
    const node = nodes[key];
    if (!node) continue;
    const owner = key === 'terminal' ? child(node, 'ade-terminal-header', 'block') : node;
    const size = owner.content?.props?.adeSoloSizing?.size ?? node.size;
    if (Number.isFinite(size?.px) && size.px > 0 || Number.isFinite(size?.weight) && size.weight > 0) sizes[node.id] = { ...size };
  }
  return sizes;
}
export function restoreProjectDimensions(tree, sizes) {
  const nodes = frameNodes(tree);
  if (!nodes || !sizes) return tree;
  const next = JSON.parse(JSON.stringify(tree)), copy = frameNodes(next);
  for (const key of ['left', 'right', ...Object.keys(REGIONS)]) {
    const node = copy[key], size = node && sizes[node.id];
    if (!size || !(Number.isFinite(size.px) && size.px > 0 || Number.isFinite(size.weight) && size.weight > 0)) continue;
    const owner = key === 'terminal' ? child(node, 'ade-terminal-header', 'block') : node;
    if (owner.content?.props?.adeSoloSizing) owner.content.props.adeSoloSizing.size = { ...size };
    else node.size = { ...size };
  }
  updateColumns(copy);
  return JSON.stringify(next) === JSON.stringify(tree) ? tree : next;
}
