// forked from design-sync lib/dts.mjs — allow short all-caps acronym component
// names (e.g. KPI) past the all-caps-constant filter. In this repo's no-dist
// mode cfg.componentSrcMap is the sole component allowlist, so loosening the
// all-caps reject only affects the explicitly-pinned 28 names (KPI is the only
// all-caps one). Everything else is re-exported unchanged from the staged lib.
export * from '../../.ds-sync/lib/dts.mjs';

// Treat an all-caps name as a constant (reject) only when it carries an
// underscore/digit or is longer than 4 chars — short pure-letter acronyms
// (KPI, URL, API) are valid component names.
const allCapsConst = (n) => /^[A-Z][A-Z0-9_]+$/.test(n) && (/[0-9_]/.test(n) || n.length > 4);
export const isComponentName = (n) =>
  !n.endsWith('Props') && !allCapsConst(n)
  && !/(?:Manager|Placements|Context)$/.test(n) && !/^use[A-Z]/.test(n);
