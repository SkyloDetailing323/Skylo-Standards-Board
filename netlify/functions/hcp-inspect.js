// Temporary diagnostic — DELETE after use.
// Fetches jobs from 2026-07-20 to find job_number 8016040659 (or 8016040429 / 8016040482),
// then fetches the full job by UUID + invoices + activity endpoints.
// GET /.netlify/functions/hcp-inspect
exports.handler = async (event) => {
  try {
    const auth = { "Authorization": `Token ${process.env.HCP_API_KEY}` };

    async function hcpGet(path) {
      const res = await fetch(`https://api.housecallpro.com/${path}`, { headers: auth });
      const text = await res.text();
      return { status: res.status, text };
    }

    // Fetch jobs on 2026-07-20 to find the split jobs by job_number
    const listRes = await hcpGet(
      "jobs?scheduled_start_min=2026-07-20T00%3A00%3A00-06%3A00&scheduled_start_max=2026-07-20T23%3A59%3A59-06%3A00&page_size=100"
    );
    const listData = JSON.parse(listRes.text || "{}");
    const jobs = listData.jobs || [];

    // Find jobs by display number (job_number field)
    const targetNumbers = ["8016040659", "8016040429", "8016040482"];
    const found = jobs.filter(j =>
      targetNumbers.includes(String(j.job_number || j.id || ""))
    );

    // If none matched by job_number, return the first 3 jobs so we can see the ID shape
    const sample = found.length > 0 ? found : jobs.slice(0, 3);

    // For the first matched/sample job, fetch full detail + invoice + activity
    let detail = null;
    if (sample.length > 0) {
      const uuid = sample[0].id;
      const [jobDetail, invoiceRes, actRes, actsRes] = await Promise.all([
        hcpGet(`jobs/${uuid}`),
        hcpGet(`jobs/${uuid}/invoices`),
        hcpGet(`jobs/${uuid}/activity`),
        hcpGet(`jobs/${uuid}/activities`),
      ]);
      detail = {
        uuid,
        job_status: jobDetail.status, job_raw: jobDetail.text,
        inv_status: invoiceRes.status, inv_raw: invoiceRes.text,
        act_status: actRes.status,    act_raw: actRes.text,
        acts_status: actsRes.status,  acts_raw: actsRes.text,
      };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        list_status:   listRes.status,
        total_jobs:    jobs.length,
        // show id + job_number + assigned_employees of each job in the sample
        sample_jobs:   sample.map(j => ({ id: j.id, job_number: j.job_number, work_status: j.work_status, assigned_employees: j.assigned_employees, total_amount: j.total_amount })),
        detail,
      }, null, 2),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: String(err), stack: err.stack }) };
  }
};
