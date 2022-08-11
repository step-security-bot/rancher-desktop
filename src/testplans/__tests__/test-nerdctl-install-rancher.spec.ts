import fetch, { Response } from 'node-fetch';
import retry from 'retry';
import util from 'util';

import { tool } from '../../../e2e/utils/TestUtils';
import { ContainerEngine } from '@/config/settings';

describe('Web page test', () => {
  let actualIt = it;
  let containerEngine: ContainerEngine;
  let containerClient: string;
  let otherContainerClient: string;
  jest.setTimeout(3_000_000);

  beforeAll(async() => {
    try {
      const stdout = await tool('rdctl', 'list-settings');

      containerEngine = JSON.parse(stdout).kubernetes.containerEngine;
      expect(containerEngine).not.toBe(ContainerEngine.NONE);
      [containerClient, otherContainerClient] = containerEngine === ContainerEngine.CONTAINERD ? ['nerdctl', 'moby'] : ['moby', 'nerdctl'];
    } catch (e) {
      console.error(`Need to run rancher-desktop first`, e);
      actualIt = it.skip;
    }
  });

  it('fetches text from well-known web pages', async() => {
    let response = await fetch('https://www.github.com/');

    expect(response.ok).toBeTruthy();
    expect(response.status).toEqual(200);
    expect(await response.text()).toMatch(/<title>.*?GitHub/i);
    response = await fetch('https://www.microsoft.com/');
    expect(response.ok).toBeTruthy();
    expect(response.status).toEqual(200);
    expect(await response.text()).toMatch(/<title>.*?Microsoft/i);
  });

  it('pushes and tests rancher/rancher', async() => {
    await tool(containerClient, 'run', '--privileged', '-d', '--restart=no', '-p', '8080:80', '-p', '8443:443', 'rancher/rancher');
    // Wait up to 300 seconds
    let i = 0;
    const limit = 30;
    let response = new Response();

    for (; i < limit; i++) {
      try {
        console.log(`QQQ: >> try ${ i }`);
        throw new Error(`error ${ i }`);
        // response = await fetch('http://localhost:8080');
      } catch (e) {
        console.log(`QQQ: Failure: ${ e } for try ${ i }`);
        await util.promisify(setTimeout)(10_000);
        console.log(`QQQ: + setTimeout`);
      }
    }
    expect(i).toBeLessThan(limit);
    console.log(`QQQ:post-response ${ i }`);

    expect(response.ok).toBeTruthy();
    expect(response.status).toEqual(200);
    console.log(`QQQ:-testing response.text()`);
    expect(await response.text()).toMatch(/Howdy! Welcome to rancher! Yeehaw!/);
    console.log(`QQQ:+testing response.text()`);
    // const operation = retry.operation({
    //   retries: 30,
    //   minTimeout: 10 * 1000,
    //   maxTimeout: 10 * 1000,
    //   randomize: false,
    // });
    // let i = 0;
    // operation.attempt(async() => {
    //   i += 1;
    //   console.log(`QQQ: >> try ${ i }`);
    //   const response = await fetch('http://localhost:8080');
    //   console.log(`QQQ:post-response ${ i }`);
    // });
  });
});
