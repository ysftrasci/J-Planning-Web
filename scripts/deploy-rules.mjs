import fs from 'node:fs';
import { GoogleAuth } from 'google-auth-library';

async function deployRules() {
  const auth = new GoogleAuth({
    keyFile: './serviceAccountKey.json',
    scopes: ['https://www.googleapis.com/auth/firebase'],
  });

  const client = await auth.getClient();
  const tokenRes = await client.getAccessToken();
  const token = tokenRes.token;

  const rulesContent = fs.readFileSync('./firestore.rules', 'utf-8');
  console.log('Deploying firestore.rules to Firebase...');

  // 1. Create ruleset
  const createRes = await fetch('https://firebaserules.googleapis.com/v1/projects/j-planning/rulesets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      source: {
        files: [
          {
            name: 'firestore.rules',
            content: rulesContent,
          },
        ],
      },
    }),
  });

  const createData = await createRes.json();
  if (!createRes.ok) {
    console.error('Failed to create ruleset:', createData);
    process.exit(1);
  }

  const rulesetName = createData.name;
  console.log('Created Ruleset:', rulesetName);

  // 2. Release ruleset
  const releaseRes = await fetch('https://firebaserules.googleapis.com/v1/projects/j-planning/releases/cloud.firestore', {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      release: {
        name: 'projects/j-planning/releases/cloud.firestore',
        rulesetName: rulesetName,
      },
    }),
  });

  const releaseData = await releaseRes.json();
  if (!releaseRes.ok) {
    console.error('Failed to release ruleset:', releaseData);
    process.exit(1);
  }

  console.log('Successfully deployed and released firestore.rules:', releaseData.name);
}

deployRules().catch((err) => {
  console.error('Deploy error:', err);
  process.exit(1);
});
