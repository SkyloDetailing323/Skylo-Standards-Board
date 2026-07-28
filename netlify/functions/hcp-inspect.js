// Temporary diagnostic — DELETE after use.
// Fetches jobs Jul 20–25 looking for split jobs (multiple assigned_employees).
// For each split job found: fetch invoice items to check for per-employee attribution.
// Also checks invoice_number field (which is the "Job #" display in HCP UI).
exports.handler = async (event) => {
  try {
    const auth = { "Authorization": `Token ${process.env.HCP_API_KEY}` };

    async function hcpGet(path) {
      const res = await fetch(`https://api.housecallpro.com/${path}`, { headers: auth });
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null };
    }

    // Fetch jobs Jul 20–25
    const listRes = await hcpGet(
      "jobs?scheduled_start_min=2026-07-20T00%3A00%3A00-06%3A00&scheduled_start_max=2026-07-25T23%3A59%3A59-06%3A00&page_size=100"
    );
    const allJobs = listRes.body?.jobs || [];

    // Find jobs with multiple assigned employees (split jobs)
    const splitJobs = allJobs.filter(j => (j.assigned_employees || []).length > 1);

    // For each split job, fetch invoice to see if items have employee attribution
    const splitDetails = await Promise.all(splitJobs.map(async (job) => {
      const invRes = await hcpGet(`jobs/${job.id}/invoices`);
      const inv0 = invRes.body?.invoices?.[0];
      return {
        uuid:              job.id,
        invoice_number:    job.invoice_number,   // this is the "Job #" shown in HCP UI
        work_status:       job.work_status,
        total_amount_cents: job.total_amount,
        assigned_employees: (job.assigned_employees || []).map(e => ({
          id: e.id,
          name: `${e.first_name} ${e.last_name}`,
          // include ALL keys on the employee object to spot any split-related fields
          all_keys: Object.keys(e),
          full: e,
        })),
        invoice: inv0 ? {
          id: inv0.id,
          amount: inv0.amount,
          items: (inv0.items || []).map(i => ({
            // include ALL keys on each item to spot any employee attribution
            all_keys: Object.keys(i),
            full: i,
          })),
          discounts: inv0.discounts,
          payments: inv0.payments,
        } : null,
      };
    }));

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date_range:       "2026-07-20 to 2026-07-25",
        total_jobs:       allJobs.length,
        split_jobs_found: splitJobs.length,
        split_details:    splitDetails,
      }, null, 2),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: String(err), stack: err.stack }) };
  }
};
