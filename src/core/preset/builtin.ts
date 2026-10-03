// The built-in presets (A20). Written in the same format a pack file uses (§4.1), so they go through the same
// validation as a diagram's own pack. Provider-neutral: the kinds are generic roles (a function, a queue), and the
// glyphs (`glyphs.ts`) are original drawings, so nothing here is a cloud vendor's artwork or logo.
//
// Colours come in light and dark pairs. Each family keeps the fill clearly tinted but dark enough (dark theme) or
// light enough (light theme) that the theme's normal text colour still reads on it; the border is the family's
// stronger shade.

interface Family { fill: { light: string; dark: string }; border_color: { light: string; dark: string } }

const compute: Family = {
  fill: { light: '#e0ebff', dark: '#1e3a5f' },
  border_color: { light: '#3b6fd8', dark: '#7aa7ff' },
};
const storage: Family = {
  fill: { light: '#def5ea', dark: '#17402f' },
  border_color: { light: '#2f9e6d', dark: '#5ad19a' },
};
const messaging: Family = {
  fill: { light: '#fff0d6', dark: '#4a3512' },
  border_color: { light: '#c9821a', dark: '#f0b45a' },
};
const network: Family = {
  fill: { light: '#ece5ff', dark: '#33285c' },
  border_color: { light: '#7048e8', dark: '#a58bff' },
};
const outside: Family = {
  fill: { light: '#f1f3f5', dark: '#2a3140' },
  border_color: { light: '#6b7785', dark: '#9aa5b4' },
};
const trust: Family = {
  fill: { light: '#ffe3e8', dark: '#4a1f2a' },
  border_color: { light: '#d6336c', dark: '#f783ac' },
};

export const BUILTIN_PACKS: Readonly<Record<string, unknown>> = {
  cloud: {
    version: 1,
    name: 'Cloud architecture',
    kinds: {
      function: { label: 'Function', aliases: ['serverless', 'fn'], icon: 'function', style: compute },
      service: { label: 'Service', aliases: ['container', 'compute', 'server'], icon: 'service', style: compute },
      'object-storage': {
        label: 'Object storage', aliases: ['bucket', 'blob-storage', 'storage'], icon: 'object-storage', style: storage,
      },
      database: { label: 'Database', aliases: ['db', 'datastore'], icon: 'database', style: storage },
      cache: { label: 'Cache', icon: 'cache', style: storage },
      queue: { label: 'Queue', aliases: ['message-queue'], icon: 'queue', style: messaging },
      topic: { label: 'Topic', aliases: ['event-bus', 'pubsub'], icon: 'topic', style: messaging },
      'api-gateway': { label: 'API gateway', aliases: ['gateway', 'api'], icon: 'api-gateway', style: network },
      'load-balancer': { label: 'Load balancer', aliases: ['lb'], icon: 'load-balancer', style: network },
      cdn: { label: 'CDN', icon: 'cdn', style: network },
      'external-service': {
        label: 'External service',
        aliases: ['external', 'saas', 'third-party'],
        icon: 'external-service',
        style: { ...outside, border_style: 'dashed' },
      },
      user: { label: 'User', aliases: ['actor', 'person', 'client'], icon: 'user', style: outside },
      identity: { label: 'Identity and access', aliases: ['auth', 'idp'], icon: 'identity', style: trust },
      scheduler: { label: 'Scheduler', aliases: ['cron', 'timer'], icon: 'scheduler', style: trust },
      monitoring: { label: 'Monitoring', aliases: ['metrics', 'observability', 'logs'], icon: 'monitoring', style: trust },
    },
  },
};

/** The names a diagram can use with `preset:` without a file. */
export function builtinPresetNames(): string[] {
  return Object.keys(BUILTIN_PACKS);
}
