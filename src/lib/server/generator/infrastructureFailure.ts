/** Host/runtime failures cannot be repaired by asking the model to rewrite app code. */
export function isInfrastructureFailure(message: string): boolean {
  return /permission denied|EACCES|Cannot connect to the Docker daemon|docker.*daemon.*unavailable|no space left on device|read-only file system/i.test(message);
}
