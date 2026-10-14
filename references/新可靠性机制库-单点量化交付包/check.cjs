// 可选页面验收：PLAYWRIGHT_MODULE 和 CHROMIUM_EXECUTABLE 可指向本机工具。
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {pathToFileURL}=require('node:url'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE});
 try{
  const context=await browser.newContext({offline:true,viewport:{width:1440,height:1100}}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(path.join(__dirname,'新可靠性机制库-单点收益审核.html')).href);
  assert.equal(await page.locator('#mechanism-table tbody tr').count(),16);assert.equal(await page.locator('article').count(),16);
  assert.equal(await page.locator('.proposal-nav a').count(),7);
  assert.equal(await page.locator('.trigger-box').count(),16);assert.equal(await page.locator('.workflow').count(),16);
  await page.locator('#expand').click();assert.equal(await page.locator('details[open]').count(),16);await page.locator('#expand').click();assert.equal(await page.locator('details[open]').count(),0);
  const task=page.waitForEvent('download');await page.locator('#export').click();const download=await task;
  const exported=JSON.parse(fs.readFileSync(await download.path(),'utf8')),saved=JSON.parse(fs.readFileSync(path.join(__dirname,'新可靠性机制库-单点量化.json'),'utf8'));
  assert.deepEqual(exported,saved);assert(exported.mechanisms.every(m=>m.simulationReady===false&&m.integration.eligibleShareOfParentEvents===null));
  assert(exported.mechanisms.every(m=>m.principle&&m.trigger.gate&&m.trigger.owner&&m.workflow.length>=3&&m.successCriteria&&m.failure));
  assert.equal(exported.mechanisms.filter(m=>m.origin==='用户补充方案').length,7);
  assert.equal(exported.precisionContext.measuredTrainingPrecisionShares,null);
  assert.equal(exported.mechanisms.find(m=>m.id==='D-ABFT').quantification.after,.995);
  assert.equal(exported.mechanisms.find(m=>m.id==='H-SDC-SCREEN').derived.actualSdcFitAfter,null);
  assert.equal(await page.locator('#D-SDC-FP8 .result').innerText().then(s=>s.includes('+95 个百分点')),true);
  assert.equal(await page.locator('#D-ABFT .result').innerText().then(s=>s.includes('+4.5 个百分点')),true);
  assert.equal(await page.locator('#H-SDC-SCREEN .result').innerText().then(s=>s.includes('FIT')),true);
  const badLinks=await page.evaluate(()=>[...document.querySelectorAll('a[href^="#"]')].filter(a=>!document.getElementById(a.hash.slice(1))).map(a=>a.hash));assert.deepEqual(badLinks,[]);
  await page.screenshot({path:'/tmp/nvlink-single-desktop.png'});
  await page.locator('#mechanism-table').screenshot({path:'/tmp/nvlink-mechanism-table.png'});
  await page.locator('#D-ABFT').screenshot({path:'/tmp/nvlink-abft-detail.png'});
  const layouts=[];for(const width of [1440,1000,390]){await page.setViewportSize({width,height:1100});const s=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert(s.scroll<=s.width+1);layouts.push(s);}
  await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));
  await page.screenshot({path:'/tmp/nvlink-single-mobile.png'});assert.deepEqual(errors,[]);
  const result={status:'passed',catalogVersion:saved.version,checks:['16 条机制总表与原理／触发／流程详情一致；含 7 项用户方案','离线打开；导出 JSON 与磁盘交付数据一致','未知适用比例、训练精度占比和实际筛查后 FIT 保持 null','百分点、秒数和 FIT 显示正确；ABFT 条件补漏计算正确','桌面与手机页面无整体横向溢出','16 个参数区展开和收起正常；目录锚点有效','无页面脚本异常'],layouts,errors};
  fs.writeFileSync(path.join(__dirname,'审核检查.json'),JSON.stringify(result,null,2));console.log(result);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
