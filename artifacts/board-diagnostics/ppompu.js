import { ENV } from "@/config/env";

test.describe("ppompu", () => {
  test("tests ppompu", async ({ page }) => {
    await page.setViewportSize({
          width: 2324,
          height: 1331
        })
    await page.goto("https://www.ppomppu.co.kr/");
    await page.goto("https://www.ppomppu.co.kr/");
    await page.locator("div.right > div:nth-of-type(1) img").click()
    expect(page.url()).toBe('https://www.ppomppu.co.kr/zboard/login.php');
    await page.locator("#user_id").type(ENV.PPOMPPU_USER_ID);
    await page.locator("#password").type(ENV.PPOMPPU_USER_PW);
    await page.locator("ul > a span").click()
    expect(page.url()).toBe('https://www.ppomppu.co.kr/zboard/login.php#none');
    await page.locator("#secret_num1").type("c");
    await page.locator("li.menu06 > a").click()
    expect(page.url()).toBe('https://www.ppomppu.co.kr/recent_main_article.php?type=market');
    await page.locator("#secret_num1").type("c");
    await page.locator("ul:nth-of-type(4) > li.board01_title > a").click()
    expect(page.url()).toBe('https://ads.pubmatic.com/AdServer/js/user_sync.html?kdntuid=1&p=156701');
    await page.locator("#secret_num1").type("c");
    await page.locator("table:nth-of-type(1) div > a").click()
    expect(page.url()).toBe('https://www.ppomppu.co.kr/zboard/write.php?id=gonggu&page=1&divpage=39&mode=write');
    await page.locator("#secret_num1").type("c");
    await page.locator("table:nth-of-type(2) button").click()
    await page.locator("tr:nth-of-type(1) > td.subject").click()
    await page.locator("div.tempas-preview button.btn_set_tempas").click()
    await page.locator("#category").click()
    await page.locator("#category").type("3");
    await page.locator("#ok_button").click()
    expect(page.url()).toBe('https://www.ppomppu.co.kr/zboard/unlimit_write_ok.php');
  });
});
