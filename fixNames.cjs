const fs = require('fs');
let code = fs.readFileSync('c:/Users/User/Desktop/HOME/foundfoundedmeet/src/App.jsx', 'utf8');

if (!code.includes('const nameWithNim')) {
  code = code.replace(
    'const memLabel = (id) => { const m = M(id); return m ? `${m.team} ${m.name}님` : id; };',
    'const memLabel = (id) => { const m = M(id); return m ? `${m.team} ${m.name === "회의실" ? m.name : m.name + "님"}` : id; };\nconst nameWithNim = (n) => n === "회의실" ? n : (n ? n + "님" : "");'
  );
}

code = code.replace(/\{r\.owner\}님/g, '{nameWithNim(r.owner)}');
code = code.replace(/\{mName\}님/g, '{nameWithNim(mName)}');
code = code.replace(/\$\{user\}님/g, '${nameWithNim(user)}');
code = code.replace(/\{user\}님/g, '{nameWithNim(user)}');
code = code.replace(/\{m\.name\}님/g, '{nameWithNim(m.name)}');
code = code.replace(/\{c\.user\}님/g, '{nameWithNim(c.user)}');
code = code.replace(/\{m\?\.name\}님/g, '{nameWithNim(m?.name)}');
code = code.replace(/\$\{detail\.owner\}님/g, '${nameWithNim(detail.owner)}');

fs.writeFileSync('c:/Users/User/Desktop/HOME/foundfoundedmeet/src/App.jsx', code);
console.log('Replacements completed.');
