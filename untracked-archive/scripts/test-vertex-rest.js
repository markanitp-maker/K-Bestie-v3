const { GoogleAuth } = require('google-auth-library');
const fs = require('fs');

async function run() {
  const env = fs.readFileSync('.env.local', 'utf8');
  const getEnv = (key) => {
    const match = env.match(new RegExp(`^${key}='?(.*?)'?$`, 'm'));
    return match ? match[1].trim() : null;
  };

  const saJsonStr = getEnv('GCP_VERTEX_SA_KEY_JSON');
  if (!saJsonStr) {
    console.error("GCP_VERTEX_SA_KEY_JSON not found");
    return;
  }
  
  const sa = JSON.parse(saJsonStr);
  const project = getEnv('GOOGLE_CLOUD_PROJECT') || sa.project_id;
  const location = getEnv('GOOGLE_CLOUD_LOCATION') || 'global';
  
  try {
    const auth = new GoogleAuth({
      credentials: sa,
      scopes: 'https://www.googleapis.com/auth/cloud-platform'
    });
    const client = await auth.getClient();
    const token = await client.getAccessToken();

    console.log(`Project: ${project}, Location: ${location}`);
    console.log(`Access Token obtained.`);

    const modelsToTest = [
      'gemini-3.5-flash-lite',
      'gemini-3.5-flash',
      'gemini-3.6-flash',
      'gemini-live-2.5-flash-native-audio',
      'gemini-2.5-flash',
      'gemini-1.5-flash'
    ];

    for (const model of modelsToTest) {
      console.log(`\nTesting model: ${model}`);
      
      const region = location === 'global' ? 'us-central1' : location; // global endpoint uses us-central1 for API calls usually, or we can just use the global api endpoint? Wait, Vertex AI requires a region like us-central1. Let's try both.
      
      const endpoint = location === 'global' ? `https://us-central1-aiplatform.googleapis.com` : `https://${location}-aiplatform.googleapis.com`;
      const url = `${endpoint}/v1/projects/${project}/locations/${location === 'global' ? 'us-central1' : location}/publishers/google/models/${model}:generateContent`;

      const body = {
        contents: [{ role: 'user', parts: [{ text: "Hello" }] }]
      };

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      if (res.ok) {
        const data = await res.json();
        console.log(`[SUCCESS] ${model}: ${data.candidates[0].content.parts[0].text.trim().substring(0, 50)}`);
      } else {
        const err = await res.json();
        console.log(`[ERROR] ${model}: ${err.error.message}`);
      }
    }

  } catch (err) {
    console.error("Setup error:", err);
  }
}
run();
