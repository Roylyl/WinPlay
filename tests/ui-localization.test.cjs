const test=require('node:test'),assert=require('node:assert/strict');
const {resolveLanguage,translate}=require('../src/ui/i18n.js');
test('language selection resolves regional Chinese and falls back predictably',()=>{
  assert.equal(resolveLanguage('system','zh-CN'),'zh-Hans');assert.equal(resolveLanguage('system','zh_TW'),'zh-Hant');assert.equal(resolveLanguage('system','zh-HK'),'zh-Hant');assert.equal(resolveLanguage('system','en-US'),'en');assert.equal(resolveLanguage('en','zh-CN'),'en');assert.equal(resolveLanguage('zh-Hant','en-US'),'zh-Hant');assert.equal(resolveLanguage('system','fr-FR'),'en');
});
test('application phrases and explicit dynamic templates translate without changing data',()=>{
  assert.equal(translate('连接','en','zh-CN'),'Connection');assert.equal(translate('音频','zh-Hant','en'),'音訊');assert.equal(translate('当前已从120fps回退至90fps','en'),'Fell back from 120fps to 90fps');assert.equal(translate('WinPlay1.2.0已发布。','en'),'WinPlay 1.2.0 is available.');assert.equal(translate('我的iPhone（12345）','en'),'我的iPhone（12345）');assert.equal(translate('这是一段歌词 · 连接','en'),'这是一段歌词 · 连接');assert.equal(translate('RAW_STATUS/0x20/AA:BB','zh-Hant'),'RAW_STATUS/0x20/AA:BB');
});
test('all static interface phrases have Traditional Chinese and English translations',()=>{
  const html=require('node:fs').readFileSync('src/ui/index.html','utf8'),phrases=[...html.matchAll(/data-i18n(?:-title|-aria|-placeholder|-alt)?="([^"]+)"/g)].map(match=>match[1]);
  for(const phrase of phrases){if(phrase==='iPhone')continue;assert.notEqual(translate(phrase,'en'),phrase,'English: '+phrase);assert.ok(translate(phrase,'zh-Hant'),'Traditional: '+phrase)}
});
