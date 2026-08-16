const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = 'e:/VibeCoding/K-Bestie-v3';
const targetDir = 'e:/VibeCoding/temp-fix-worktree';

console.log("=== Setting up clean worktree fixes ===");

// 1. Copy lib/auth/membershipState.ts
fs.copyFileSync(
  path.join(rootDir, 'lib/auth/membershipState.ts'),
  path.join(targetDir, 'lib/auth/membershipState.ts')
);

// 2. Copy app/api/auth/membership-status/route.ts
fs.copyFileSync(
  path.join(rootDir, 'app/api/auth/membership-status/route.ts'),
  path.join(targetDir, 'app/api/auth/membership-status/route.ts')
);

// 3. Copy app/api/signup/consent/route.ts
fs.copyFileSync(
  path.join(rootDir, 'app/api/signup/consent/route.ts'),
  path.join(targetDir, 'app/api/signup/consent/route.ts')
);

// 4. Update app/page.tsx error message
let pageContent = fs.readFileSync(path.join(rootDir, 'app/page.tsx'), 'utf8');
pageContent = pageContent.replace('네트워크 연결을 확인할 수 없어요.', '회원 정보를 불러오지 못했습니다. 다시 시도해 주세요.');
fs.writeFileSync(path.join(targetDir, 'app/page.tsx'), pageContent, 'utf8');

console.log("Files copied to temp-fix-worktree.");

// Verify porcelain status in worktree
const porcelain = execSync(`wsl bash -c "cd /mnt/e/VibeCoding/temp-fix-worktree && git status --porcelain"`, { encoding: 'utf8' });
console.log("Worktree modified files:");
console.log(porcelain || "(No modified files)");
