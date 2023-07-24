import type { Page, Locator } from '@playwright/test';

export class WslNav {
  readonly page: Page;
  readonly nav: Locator;
  readonly networkingTunnel: Locator;
  readonly wslIntegrations: Locator;
  readonly addressTitle: Locator;
  readonly tabIntegrations: Locator;
  readonly tabNetwork: Locator;
  readonly tabProxy: Locator;
  readonly alpha: Locator;
  readonly beta: Locator;
  readonly gamma: Locator;

  constructor(page: Page) {
    this.page = page;
    this.nav = page.locator('[data-test="nav-wsl"]');
    this.networkingTunnel = page.locator('[data-test="networkingTunnel"]');
    this.tabIntegrations = page.locator('.tab >> text=Integrations');
    this.tabNetwork = page.locator('.tab >> text=Network');
    this.tabProxy = page.locator('.tab >> text=Proxy');
    this.wslIntegrations = page.locator('[data-test="wslIntegrations"]');
    this.addressTitle = page.locator('[data-test="addressTitle"]');
    this.alpha = page.locator('[data-test="item-alpha"] input[type="checkbox"]');
    this.beta = page.locator('[data-test="item-beta"] input[type="checkbox"]');
    this.gamma = page.locator('[data-test="item-gamma"] input[type="checkbox"]');
  }
}
