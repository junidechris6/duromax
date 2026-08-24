const puppeteer = require('puppeteer');

(async () => {
  console.log("Launching Puppeteer...");
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  
  // Set viewport to mobile
  await page.setViewport({ width: 375, height: 667, isMobile: true, hasTouch: true });
  
  console.log("Navigating to http://localhost:3001/interiorsprivateprivilege/ ...");
  try {
    await page.goto('http://localhost:3001/interiorsprivateprivilege/', { waitUntil: 'networkidle2' });
  } catch (err) {
    console.error("Navigation error:", err.message);
  }
  
  // Analyze wrapper background and input pseudo styles
  const testResults = await page.evaluate(() => {
    const input = document.querySelector('input[type="date"]');
    if (!input) return { error: "No input found" };
    
    const wrapper = input.parentElement;
    
    // Get computed styles
    const inputStyles = window.getComputedStyle(input);
    const beforeStyles = window.getComputedStyle(input, '::before');
    const wrapperStyles = window.getComputedStyle(wrapper);
    
    return {
      inputWidth: inputStyles.width,
      inputPaddingRight: inputStyles.paddingRight,
      inputBeforeDisplay: beforeStyles.display,
      inputBeforeContent: beforeStyles.content,
      inputBeforeOpacity: beforeStyles.opacity,
      wrapperWidth: wrapperStyles.width,
      wrapperBackground: wrapperStyles.backgroundImage,
      wrapperBackgroundPosition: wrapperStyles.backgroundPosition,
      wrapperBackgroundSize: wrapperStyles.backgroundSize
    };
  });
  
  console.log("Custom SVG Calendar Icon Style Check:", JSON.stringify(testResults, null, 2));
  
  await browser.close();
  console.log("Puppeteer finished.");
})();
