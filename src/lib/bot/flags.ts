interface FlagOptions {
  ads?: string;
  force?: boolean;
  keepOld?: boolean;
  verbose?: boolean;
}

/**
 * Build CLI flags string from options.
 * When force is true, --ads is omitted (force implies all).
 */
export function buildFlags(opts: FlagOptions): string {
  const flags: string[] = [];

  if (opts.force) {
    flags.push('--force');
  } else if (opts.ads) {
    flags.push(`--ads=${opts.ads}`);
  }

  if (opts.keepOld) {
    flags.push('--keep-old');
  }

  if (opts.verbose) {
    flags.push('--verbose');
  }

  return flags.join(' ');
}
