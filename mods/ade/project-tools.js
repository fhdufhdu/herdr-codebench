import { shared, setShared } from 'herdr';
import { currentProject, projectKey } from './workspace.js';
import { regionSettings, projectDimensions, restoreProjectDimensions, arrangeRegions } from './frame-layout.js';

const STATE = 'ade.project-tools';
const DEFAULTS = 'ade.project-tool-defaults';
export function toolSettings(context = currentProject()) {
  return shared(STATE)?.[projectKey(context)]?.tools ?? shared('ade.tool-settings') ?? {};
}
export function captureProjectTools(tree, metadata = toolSettings()) {
  const tools = regionSettings(tree, metadata);
  return tools ? { tools, dimensions: projectDimensions(tree) } : null;
}
export function saveProjectTools(context, state) {
  if (!state) return;
  const key = projectKey(context), saved = shared(STATE) ?? {};
  if (JSON.stringify(saved[key]) !== JSON.stringify(state)) setShared(STATE, { ...saved, [key]: state });
}
export function initialProjectTools(context, tree) {
  const live = captureProjectTools(tree, toolSettings(context));
  if (!live) return null;
  if (!shared(DEFAULTS)) setShared(DEFAULTS, live);
  const saved = shared(STATE)?.[projectKey(context)];
  if (saved) return saved;
  const dimensions = shared('ade.project-dimensions')?.[projectKey(context)] ?? live.dimensions;
  const initial = { ...live, dimensions };
  saveProjectTools(context, initial);
  return initial;
}
export function savedProjectTools(context) {
  return shared(STATE)?.[projectKey(context)] ?? {
    ...shared(DEFAULTS),
    dimensions: shared('ade.project-dimensions')?.[projectKey(context)] ?? shared(DEFAULTS)?.dimensions,
  };
}
export function restoreProjectTools(tree, state) {
  if (!state?.tools) return tree;
  const next = restoreProjectDimensions(arrangeRegions(tree, state.tools), state.dimensions);
  return JSON.stringify(next) === JSON.stringify(tree) ? tree : next;
}
