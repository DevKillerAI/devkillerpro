/** Database applications must retain the actual results of every executed check. */
export function assertFullstackRelease(report: {
  status: string;
  failures: readonly string[];
  checks: readonly {id: string; passed: boolean}[];
}): void {
  const failed = report.checks.filter(check => !check.passed).map(check => check.id);
  if (report.status !== 'passed' || report.failures.length || failed.length) {
    throw new Error(`Full-stack verification incomplete. ${[...failed, ...report.failures].join('; ').slice(0, 1200)} Database, authentication and functional failures cannot be promoted to an approved delivery.`);
  }
}
