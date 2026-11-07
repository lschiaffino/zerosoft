/**
 * The public source repository, as "owner/name". Used for the GitHub links on
 * the site and for desktop releases. Forks set NEXT_PUBLIC_GITHUB_REPO so their
 * links point at their own repository.
 */
const DEFAULT_GITHUB_REPO = 'lschiaffino/zerosoft';

function repoFromEnv(value: string | undefined): string {
  const repo = value?.trim();
  return repo && /^[\w.-]+\/[\w.-]+$/.test(repo) ? repo : DEFAULT_GITHUB_REPO;
}

export const GITHUB_REPO = repoFromEnv(process.env.NEXT_PUBLIC_GITHUB_REPO);

export const GITHUB_URL = `https://github.com/${GITHUB_REPO}`;
