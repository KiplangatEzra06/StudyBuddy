export function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function readJSONFile(file, cb) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try { cb(JSON.parse(reader.result)); }
    catch (e) { alert('Could not read that file. Make sure it is valid JSON.'); }
  };
  reader.readAsText(file);
}

export function downloadText(content, name, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
