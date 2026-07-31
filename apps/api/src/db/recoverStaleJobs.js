/** Mark in-flight build jobs as failed after an unclean API restart. */
export async function recoverStaleBuildJobs(pool) {
  const { rowCount: jobs } = await pool.query(`
    UPDATE build_jobs
    SET status = 'error',
        message = 'Build interrupted by server restart. Run build again.',
        finished_at = NOW()
    WHERE status IN ('queued', 'running')
  `);

  const { rowCount: bots } = await pool.query(`
    UPDATE bots
    SET status = CASE WHEN chunk_count > 0 THEN 'ready' ELSE 'draft' END,
        build_error = 'Previous build was interrupted. Run build again.'
    WHERE status = 'building'
  `);

  if (jobs > 0 || bots > 0) {
    console.log(`Recovered stale state: ${jobs} job(s), ${bots} bot(s)`);
  }
}
