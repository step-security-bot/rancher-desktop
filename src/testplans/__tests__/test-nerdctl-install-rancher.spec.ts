import fetch, { Response } from 'node-fetch';
import https from 'https';
// import retry from 'retry';
// import util from 'util';

import { tool } from '../../../e2e/utils/TestUtils';

import { ContainerEngine } from '@/config/settings';
import * as childProcess from '@/utils/childProcess';

async function runAgainstContainerEngine(containerClient: string, imageName: string) {
  const expectedString = {
    nginx:             /<title>Welcome to nginx!<\/title>/,
    'rancher/rancher': /"group":"management.cattle.io"/,
  }[imageName];
  const command = `${ containerClient } ps | grep ${ imageName } | awk '{ print $1 }' | xargs -I@ -n 1 bash -c '${ containerClient } stop @ && ${ containerClient } rm @'`;

  expect(expectedString).toBeDefined();
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
        console.log(`Failure: ${ e } for try ${ i }`);
        // For some reason this doesn't work:
        // await util.promisify(setTimeout)(10_000);
        // so call sleep ...
        await childProcess.spawnFile('sleep', ['10']);
      }
    }
    expect(i).toBeLessThan(limit);

    if (!response.ok || response.status >= 400) {
      console.log(`2nd-round Failure: try ${ i }: ${ response.ok }, status: ${ response.status }`);
      // await util.promisify(setTimeout)(10_000);
      await childProcess.spawnFile('sleep', ['10']);
      i += 1;
      continue;
    }
    break;
  }

  expect(await response.text()).toMatch(expectedString as string|RegExp);
}

describe('Web page test', () => {
  let actualIt = it;
  let containerEngine: ContainerEngine;
  let otherEngineName: string;
  let containerClient: string;
  let otherContainerClient: string;
  jest.setTimeout(3_000_000);

  beforeAll(async() => {
    try {
      const stdout = await tool('rdctl', 'list-settings');

      containerEngine = JSON.parse(stdout).kubernetes.containerEngine;
      expect(containerEngine).not.toBe(ContainerEngine.NONE);
      [containerClient, otherContainerClient, otherEngineName] = containerEngine === ContainerEngine.CONTAINERD ? ['nerdctl', 'docker', 'moby'] : ['docker', 'nerdctl', 'containerd'];
    } catch (e) {
      console.error(`Need to run rancher-desktop first`, e);
      actualIt = it.skip;
    }
  });

  actualIt('fetches text from well-known web pages', async() => {
    let response = await fetch('https://www.github.com/');

    expect(response.ok).toBeTruthy();
    expect(response.status).toEqual(200);
    expect(await response.text()).toMatch(/<title>.*?GitHub/i);
    response = await fetch('https://www.microsoft.com/');
    expect(response.ok).toBeTruthy();
    expect(response.status).toEqual(200);
    expect(await response.text()).toMatch(/<title>.*?Microsoft/i);
  });

  actualIt('pushes and tests rancher/rancher with the first engine', async() => {
    // const imageName: 'nginx'|'rancher/rancher' = 'rancher/rancher';
    // let imageName: 'nginx' | 'rancher/rancher' = 'nginx';
    await runAgainstContainerEngine(containerClient, 'rancher/rancher');
  });

  actualIt('switches the containerEngine', async() => {
    await tool('rdctl', 'set', '--container-engine', otherEngineName);
    await childProcess.spawnFile('sleep', ['10']);
    let i = 0;
    const limit = 60;

    // Just wait for the container engine to come up before continuing
    for (; i < limit; i++) {
      try {
        await tool(otherContainerClient, 'ps');
        break;
      } catch (e) {
        // For some reason this doesn't rwork:
        // await util.promisify(setTimeout)(10_000);
        await childProcess.spawnFile('sleep', ['10']);
      }
    }
  });

  actualIt('pushes and tests rancher/rancher with the second engine', async() => {
    await runAgainstContainerEngine(otherContainerClient, 'rancher/rancher');
  });
});
