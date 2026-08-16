const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');
const path = require('path');

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
  
  const tempKeyPath = path.join(__dirname, 'temp-sa.json');
  fs.writeFileSync(tempKeyPath, saJsonStr);
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tempKeyPath;

  console.log(`Project: ${project}, Location: ${location}`);

  try {
    const ai = new GoogleGenAI({
      vertexai: {
        project: project,
        location: location,
      }
    });

    console.log("Initializing Vertex AI client...");

    const modelsToTest = [
      'gemini-3.5-flash-lite',
      'gemini-3.5-flash',
      'gemini-3.6-flash',
      'gemini-live-2.5-flash-native-audio',
      'gemini-1.5-flash'
    ];

    for (const model of modelsToTest) {
      try {
        console.log(`\nTesting model: ${model}`);
        const response = await ai.models.generateContent({
          model: model,
          contents: "Hello",
        });
        console.log(`[SUCCESS] ${model}: ${response.text.trim()}`);
      } catch (err) {
        console.error(`[ERROR] ${model}: ${err.message}`);
      }
    }

  } catch (err) {
    console.error("Setup error:", err);
  } finally {
    if (fs.existsSync(tempKeyPath)) {
      fs.unlinkSync(tempKeyPath);
    }
  }
}
run();
