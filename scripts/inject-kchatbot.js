const fs = require('fs');
const path = require('path');

const pages = [
  { path: 'app/chat/page.tsx', surface: 'child' },
  { path: 'app/child/home/page.tsx', surface: 'child' },
  { path: 'app/child/missions/page.tsx', surface: 'child' },
  { path: 'app/child/play/page.tsx', surface: 'child' },
  { path: 'app/child/settings/page.tsx', surface: 'child' },
  { path: 'app/parent/guide/page.tsx', surface: 'parent' },
  { path: 'app/parent/home/page.tsx', surface: 'parent' },
  { path: 'app/parent/notifications/page.tsx', surface: 'parent' },
  { path: 'app/parent/report/page.tsx', surface: 'parent' },
  { path: 'app/parent/report/weekly/page.tsx', surface: 'parent' },
  { path: 'app/parent/report/weekly/[id]/page.tsx', surface: 'parent' },
  { path: 'app/parent/report/[id]/page.tsx', surface: 'parent' },
  { path: 'app/parent/settings/page.tsx', surface: 'parent' },
];

for (const p of pages) {
  const fullPath = path.join(__dirname, '..', p.path);
  if (!fs.existsSync(fullPath)) {
    console.log('Skipping missing file:', p.path);
    continue;
  }
  let content = fs.readFileSync(fullPath, 'utf8');

  if (content.includes('<KChatbotWidget')) {
    console.log('Already injected:', p.path);
    continue;
  }

  // Inject import
  const importStatement = `import KChatbotWidget from "@/components/KChatbotWidget";\n`;
  // find last import
  const lastImportIndex = content.lastIndexOf('import ');
  if (lastImportIndex !== -1) {
    const endOfLastImport = content.indexOf('\n', lastImportIndex);
    content = content.slice(0, endOfLastImport + 1) + importStatement + content.slice(endOfLastImport + 1);
  } else {
    content = importStatement + content;
  }

  // Inject component. Let's find the closing tag of the main component return.
  // Most pages return <DemoFrame> ... </DemoFrame> or something similar.
  // We can look for the last closing tag in the file before the final parenthesis.
  // The simplest is to look for the last `</DemoFrame>` or `</div>` or `</main>` or `</>`.
  const tagsToLookFor = ['</DemoFrame>', '</main>', '</div>', '</>'];
  let injected = false;
  
  for (const tag of tagsToLookFor) {
    const tagIndex = content.lastIndexOf(tag);
    if (tagIndex !== -1) {
      const widget = `\n        <KChatbotWidget appSurface="${p.surface}" />\n      `;
      content = content.slice(0, tagIndex) + widget + content.slice(tagIndex);
      injected = true;
      break;
    }
  }

  if (!injected) {
    console.log('Failed to find injection point for:', p.path);
  } else {
    fs.writeFileSync(fullPath, content, 'utf8');
    console.log('Injected into:', p.path);
  }
}
