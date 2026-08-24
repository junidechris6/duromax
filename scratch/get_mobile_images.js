const puppeteer = require("puppeteer");

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });
  const page = await browser.newPage();
  
  // Set viewport to mobile
  await page.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true });
  
  console.log("Loading page...");
  await page.goto("http://localhost:3000/", { waitUntil: "networkidle2" });
  
  // Extract image sources
  const images = await page.evaluate(() => {
    const results = [];
    // Extract all img tags
    document.querySelectorAll("img").forEach((img) => {
      results.push({
        tag: "img",
        src: img.getAttribute("src"),
        srcset: img.getAttribute("srcset"),
        class: img.className,
        id: img.id
      });
    });
    
    // Extract divs with background-image
    document.querySelectorAll("div").forEach((div) => {
      const bg = window.getComputedStyle(div).backgroundImage;
      if (bg && bg !== "none") {
        results.push({
          tag: "div-bg",
          bg: bg,
          class: div.className,
          id: div.id
        });
      }
    });
    
    return results;
  });
  
  console.log("Images found:");
  console.log(JSON.stringify(images, null, 2));
  
  await browser.close();
})();
