// Temporary diagnostic — DELETE after use.
// GET /.netlify/functions/hcp-inspect?jobId=8016040659
exports.handler = async (event) => {
  try {
    const jobId = (event.queryStringParameters || {}).jobId || "8016040659";
    const authHeader = { "Authorization": `Token ${process.env.HCP_API_KEY}` };

    const jobRes = await fetch(`https://api.housecallpro.com/jobs/${jobId}`, { headers: authHeader });
    const jobText = await jobRes.text();

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: jobRes.status, raw: jobText }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: String(err) }) };
  }
};
