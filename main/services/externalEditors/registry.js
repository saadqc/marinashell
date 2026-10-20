const EDITORS = [
  { id: 'islet', name: 'Islet', family: 'islet', apps: ['Islet'], commands: ['islet'], windows: [] },
  { id: 'vscode', name: 'VS Code', family: 'code', apps: ['Visual Studio Code'], commands: ['code'], windows: ['Microsoft VS Code/Code.exe'] },
  { id: 'antigravity', name: 'Antigravity IDE', family: 'code', apps: ['Antigravity IDE', 'Antigravity'], commands: ['antigravity-ide', 'antigravity'], windows: ['Antigravity IDE/Antigravity IDE.exe', 'Antigravity/Antigravity.exe'] },
  { id: 'pycharm', name: 'PyCharm', family: 'jetbrains', productCodes: ['PY', 'PC'], moduleType: 'PYTHON_MODULE', apps: ['PyCharm', 'PyCharm CE'], commands: ['pycharm', 'pycharm64', 'pycharm.sh'], windows: ['JetBrains/PyCharm/bin/pycharm64.exe'] },
  { id: 'sublime', name: 'Sublime Text', family: 'sublime', apps: ['Sublime Text'], commands: ['subl', 'sublime_text'], windows: ['Sublime Text/sublime_text.exe', 'Sublime Text/subl.exe'] },
  { id: 'webstorm', name: 'WebStorm', family: 'jetbrains', productCodes: ['WS'], moduleType: 'WEB_MODULE', apps: ['WebStorm'], commands: ['webstorm', 'webstorm64', 'webstorm.sh'], windows: ['JetBrains/WebStorm/bin/webstorm64.exe'] },
  { id: 'idea', name: 'IntelliJ IDEA', family: 'jetbrains', productCodes: ['IU', 'IC'], moduleType: 'JAVA_MODULE', apps: ['IntelliJ IDEA', 'IntelliJ IDEA CE'], commands: ['idea', 'idea64', 'idea.sh'], windows: ['JetBrains/IntelliJ IDEA/bin/idea64.exe'] }
];
const editorById = id => EDITORS.find(editor => editor.id === id);
function validatePreferences(value) {
  if (value === undefined) return;
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      (value.preferredEditorId !== undefined && value.preferredEditorId !== '' && !editorById(value.preferredEditorId))) {
    throw new Error('Choose a supported external editor.');
  }
}
function readPreferences(settings) {
  const values = settings?.editor?.externalEditors || {};
  return { defaultEditorId: values.defaultEditorId?.value || '', overrides: values.overrides?.value || {} };
}
function validateSettings(settings) {
  const values = readPreferences(settings);
  if (values.defaultEditorId && !editorById(values.defaultEditorId)) throw new Error('Choose a supported default editor.');
  if (!values.overrides || typeof values.overrides !== 'object' || Array.isArray(values.overrides)) throw new Error('Invalid editor paths.');
  for (const [id, location] of Object.entries(values.overrides)) {
    if (!editorById(id) || typeof location !== 'string' || location.length > 4096 || /[\0\r\n]/.test(location)) throw new Error('Invalid editor path.');
  }
}
module.exports = { EDITORS, editorById, readPreferences, validatePreferences, validateSettings };
