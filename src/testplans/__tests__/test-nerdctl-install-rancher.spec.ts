import fetch, { Response } from 'node-fetch';
import https from 'https';
// import retry from 'retry';
// import util from 'util';

import { tool } from '../../../e2e/utils/TestUtils';

import { ContainerEngine } from '@/config/settings';
import * as childProcess from '@/utils/childProcess';

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
      [containerClient, otherContainerClient] = containerEngine === ContainerEngine.CONTAINERD ? ['nerdctl', 'docker'] : ['docker', 'nerdctl'];
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
    // const imageName: 'nginx'|'rancher/rancher' = 'rancher/rancher';
    let imageName: 'nginx'|'rancher/rancher' = 'nginx';
    const expectedString = {
      nginx: /<title>Welcome to nginx!<\/title>/,
      'rancher/rancher': /"group":"management.cattle.io"/,
    }[imageName];
    const command = `${ containerClient } ps | grep ${ imageName } | awk '{ print $1 }' | xargs -I@ -n 1 bash -c '${ containerClient } stop @ && ${ containerClient } rm @'`;

    // Typescript is annoying
    if (Math.random() < 0.0000001) {
      imageName = 'rancher/rancher';
    }
    if (Math.random() < 0.0000001) {
      imageName = 'nginx';
    }
    try {
      await childProcess.spawnFile('bash', ['-c', command]);
    } catch(e: any) {
      console.log(`Ignoring error ${ e }`);
    }
    await tool(containerClient, 'run', '--privileged', '-d', '--restart=no', '-p', '8080:80', '-p', '8443:443', imageName);
    // Wait up to 600 seconds
    let i = 0;
    const limit = 60;
    let response = new Response();
    const httpsAgent = new https.Agent({
      rejectUnauthorized: false,
    });

    // Looks like rancher comes up in two steps
    // First, is the server running?
    // Then, is it actually doing stuff?
    while (i < limit) {
      for (; i < limit; i++) {
        try {
          console.log(`QQQ: >> try ${ i }`);
          // throw new Error(`error ${ i }`);
          switch (imageName) {
          case 'nginx':
            response = await fetch('http://127.0.0.1:8080/index.html');
            break;
          case 'rancher/rancher':
            response = await fetch('https://127.0.0.1:8443/', { agent: httpsAgent });
            break;
          }
          break;
        } catch (e) {
          console.log(`QQQ: Failure: ${ e } for try ${ i }`);
          // For some reason this doesn't work:
          // await util.promisify(setTimeout)(10_000);
          await childProcess.spawnFile('sleep', ['10']);
          console.log(`QQQ: + setTimeout`);
        }
      }
      expect(i).toBeLessThan(limit);
      console.log(`QQQ:post-response ${ i }`);

      if (!response.ok || response.status >= 400) {
        console.log(`QQQ: Failure: try ${ i }: ${ response.ok }, status: ${ response.status }`);
        // await util.promisify(setTimeout)(10_000);
        await childProcess.spawnFile('sleep', ['10']);
        console.log(`QQQ: + setTimeout`);
        i += 1;
        continue;
      }
      break;
    }

    // expect(response.ok).toBeTruthy();
    // expect(response.status).toEqual(200);
    console.log(`QQQ:-testing response.text()`);
    expect(await response.text()).toMatch(expectedString);
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
