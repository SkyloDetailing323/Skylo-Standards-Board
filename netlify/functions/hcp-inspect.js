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

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      job_status:         job.status,
      job_body:           job.body,
      invoices_status:    invoices.status,
      invoices_body:      invoices.body,
      activity_status:    activityA.status,
      activity_body:      activityA.body,
      activities_status:  activityB.status,
      activities_body:    activityB.body,
    }, null, 2),
  };
};
