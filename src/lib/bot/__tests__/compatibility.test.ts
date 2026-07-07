import { describe, expect, it } from 'vitest';
import { parseUpstreamSource } from '../compatibility';

// __init__.py-style source before the `extract CLI bootstrap` refactor:
// argument parsing and the dispatch switch live in the same module.
const INIT_PY_LEGACY = `
    def run(self, args):
        match command:
            case "publish":
                self.publish_ads()
            case "download":
                self.download_ads()
            case "--force":
                self.ads_selector = "all"
            case "--keep-old":
                self.keep_old_ads = True
            case "--lang":
                self.lang = value
            case "help":
                self.show_help()
            case "version":
                self.show_version()
`;

// cli.py after the refactor: the `case "--flag"` branches relocated here,
// while __init__.py keeps only the command dispatch.
const INIT_PY_AFTER_REFACTOR = `
    def run(self, args):
        match command:
            case "publish":
                self.publish_ads()
            case "download":
                self.download_ads()
`;

const CLI_PY_AFTER_REFACTOR = `
    def parse_args(self, argv):
        for opt, value in opts:
            match opt:
                case "--force":
                    self.ads_selector = "all"
                case "--keep-old":
                    self.keep_old_ads = True
                case "--lang":
                    self.lang = value
`;

// app.py after `split command orchestration handlers` (#1155): the command
// dispatch `match self.command:` relocated here, leaving __init__.py without
// any `case "command":` branch at all.
const APP_PY_AFTER_REFACTOR = `
    def execute(self):
        match self.command:
            case "help":
                self.show_help()
            case "version":
                self.show_version()
            case "publish":
                self.publish_ads()
            case "download":
                self.download_ads()
            case "delete":
                self.delete_ads()
`;

describe('parseUpstreamSource', () => {
  it('extracts commands and flags from a single legacy module', () => {
    const { commands, flags } = parseUpstreamSource(INIT_PY_LEGACY);
    expect(commands).toEqual(expect.arrayContaining(['publish', 'download']));
    expect(flags).toEqual(expect.arrayContaining(['--force', '--keep-old', '--lang']));
  });

  it('excludes help and version from commands', () => {
    const { commands } = parseUpstreamSource(INIT_PY_LEGACY);
    expect(commands).not.toContain('help');
    expect(commands).not.toContain('version');
  });

  it('finds no flags in __init__.py once parsing is extracted to cli.py', () => {
    const { flags } = parseUpstreamSource(INIT_PY_AFTER_REFACTOR);
    expect(flags).toEqual([]);
  });

  it('recovers the relocated flags from cli.py — the regression that caused false "flag removed" errors', () => {
    const initResult = parseUpstreamSource(INIT_PY_AFTER_REFACTOR);
    const cliResult = parseUpstreamSource(CLI_PY_AFTER_REFACTOR);
    // Mirrors the merge in checkUpstreamCompatibility: a flag counts as
    // supported if any parsed module defines it.
    const mergedFlags = [...new Set([...initResult.flags, ...cliResult.flags])];
    expect(mergedFlags).toEqual(expect.arrayContaining(['--force', '--keep-old']));
  });

  it('finds no commands in __init__.py once dispatch is extracted to app.py', () => {
    const { commands } = parseUpstreamSource(INIT_PY_AFTER_REFACTOR);
    expect(commands).toEqual(['publish', 'download']);
    // After the real #1155 refactor __init__.py keeps no dispatch at all; this
    // fixture is a stand-in. The regression below covers the empty case.
  });

  it('recovers the relocated commands from app.py — the regression that caused false "command removed" errors', () => {
    // __init__.py no longer carries any command dispatch after #1155.
    const initResult = parseUpstreamSource('def noop(): pass');
    const appResult = parseUpstreamSource(APP_PY_AFTER_REFACTOR);
    // Mirrors the merge in checkUpstreamCompatibility: a command counts as
    // supported if any parsed module defines it.
    const mergedCommands = [...new Set([...initResult.commands, ...appResult.commands])];
    expect(mergedCommands).toEqual(expect.arrayContaining(['publish', 'download', 'delete']));
    expect(mergedCommands).not.toContain('help');
    expect(mergedCommands).not.toContain('version');
  });

  it('returns empty arrays for source without case statements', () => {
    const { commands, flags } = parseUpstreamSource('def noop(): pass');
    expect(commands).toEqual([]);
    expect(flags).toEqual([]);
  });
});
