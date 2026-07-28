// Temporary diagnostic — DELETE after use.
// GET /.netlify/functions/hcp-inspect?jobId=8016040659
exports.handler = async (event) => {
  const jobId = event.queryStringParameters?.jobId || "8016040659";
  const headers = { "Authorization": `Token ${process.env.HCP_API_KEY}`, "Content-Type": "application/json" };

  async function hcpGet(path) {
    const res = await fetch(`https://api.housecallpro.com/${path}`, { headers });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }

  const [job, invoices, activityA, activityB] = await Promise.all([
    hcpGet(`jobs/${jobId}`),
    hcpGet(`jobs/${jobId}/invoices`),
    hcpGet(`jobs/${jobId}/activity`),
    hcpGet(`jobs/${jobId}/activities`),
  ]);

  // Pull just the fields relevant to splits + line items so the response stays readable
  const jobData = job.body?.job || job.body;
  const split = {
    id:                 jobData?.id,
    work_status:        jobData?.work_status,
    total_amount:       jobData?.total_amount,
    tip_amount:         jobData?.tip_amount,
    assigned_employees: jobData?.assigned_employees,
  };

  const inv0 = invoices.body?.invoices?.[0];
  const invoiceSplit = inv0 ? {
    id:        inv0.id,
    job_id:    inv0.job_id,
    items:     inv0.items,
    discounts: inv0.discounts,
    payments:  inv0.payments,
  } : null;

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      job_split_fields:   split,
      invoice_fields:     invoiceSplit,
      activity_status:    activityA.status,
      activity_body:      activityA.body,
      activities_status:  activityB.status,
      activities_body:    activityB.body,
    }, null, 2),
  };
};
