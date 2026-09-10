import { test, expect } from '@playwright/test';

test('solo setup stays off the menu and remains usable on laptops, phones, and zoom-sized viewports', async ({page,baseURL},testInfo) => {
  await page.addInitScript(()=>localStorage.setItem('voidbreaker-save-v1',JSON.stringify({version:1,settings:{quality:'low',volume:0}})));
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  for(const [width,height] of [[1366,768],[1280,720],[1024,600],[390,844],[844,390],[683,384]]) {
    await page.setViewportSize({width,height});await page.goto(baseURL);
    const background=await page.locator('.space-view').boundingBox();
    expect(background.height).toBeGreaterThanOrEqual(height-1);
    await expect(page.getByLabel('Mission mode')).toHaveCount(0);
    await expect(page.getByRole('tab')).toHaveCount(0);
    await page.getByRole('button',{name:'LAUNCH SOLO'}).click();
    await expect(page.getByRole('dialog',{name:'CHOOSE YOUR FLIGHT.'})).toBeVisible();
    await expect(page.locator('.ship-preview img')).toHaveCount(3);
    await expect.poll(()=>page.locator('.ship-preview img').evaluateAll(images=>images.every(i=>i.complete && i.naturalWidth>0))).toBe(true);
    await page.getByLabel('Mission mode').selectOption('endless');
    await page.getByLabel('Difficulty',{exact:true}).selectOption('ace');
    await page.getByRole('tab',{name:/WRAITH/}).click();
    const overflow=await page.evaluate(()=>({body:document.documentElement.scrollWidth>innerWidth+1,dialog:document.querySelector('.solo-setup').scrollWidth>document.querySelector('.solo-setup').clientWidth+1}));
    expect(overflow).toEqual({body:false,dialog:false});
    const launch=page.getByRole('button',{name:'BEGIN MISSION'});await launch.scrollIntoViewIfNeeded();await expect(launch).toBeInViewport();
    if(width===1366 || width===390) await page.screenshot({path:testInfo.outputPath(`setup-${width}.png`)});
    await launch.click();await expect(page.locator('.pilot-name')).toContainText('WRAITH');
    await expect(page.locator('.in-game')).toBeVisible();
    await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'RESUME FLIGHT'})).toBeVisible();
  }
  expect(errors).toEqual([]);
});
