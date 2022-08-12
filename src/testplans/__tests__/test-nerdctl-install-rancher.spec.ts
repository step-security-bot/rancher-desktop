import fetch, { Response } from 'node-fetch';
import https from 'https';
import util from 'util';

import { tool } from '../../../e2e/utils/TestUtils';

import { ContainerEngine } from '@/config/settings';
import * as childProcess from '@/utils/childProcess';

async function sleepItOff(timeInSeconds: number, forceSpawn=false) {
  // For some reason this doesn't always work:
  // if (!forceSpawn) {
  //   await util.promisify(setTimeout)(timeInSeconds * 1_000);
  //   return false;
  // }
  await childProcess.spawnFile('sleep', [timeInSeconds.toString()]);
}

async function runAgainstContainerEngine(containerClient: string, imageName: string) {
  const expectedString = {
    nginx:             /<title>Welcome to nginx!<\/title>/,
    'rancher/rancher': /"group":"management.cattle.io"/,
  }[imageName];
  const command = `${ containerClient } ps | grep ${ imageName } | awk '{ print $1 }' | xargs -I@ -n 1 bash -c '${ containerClient } stop @ && ${ containerClient } rm @'`;

  expect(expectedString).toBeDefined();
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
        await sleepItOff(10);
      }
    }
    expect(i).toBeLessThan(limit);

    if (!response.ok || response.status >= 400) {
      console.log(`2nd-round Failure: try ${ i }: ${ response.ok }, status: ${ response.status }`);
      await sleepItOff(10);
      i += 1;
      continue;
    }
    break;
  }

  expect(await response.text()).toMatch(expectedString as string|RegExp);
}

describe('Web page test', () => {
  let skipTests = false;
  let containerEngine: ContainerEngine;
  let otherEngineName: string;
  let containerClient: string;
  let otherContainerClient: string;
  let kubernetesStatus: boolean;
  jest.setTimeout(3_000_000);

  beforeAll(async() => {
    try {
      const stdout = await tool('rdctl', 'list-settings');
      const settings = JSON.parse(stdout);

      containerEngine = settings.kubernetes.containerEngine;
      kubernetesStatus = settings.kubernetes.enabled;
      expect(containerEngine).not.toBe(ContainerEngine.NONE);
      [containerClient, otherContainerClient, otherEngineName] = containerEngine === ContainerEngine.CONTAINERD ? ['nerdctl', 'docker', 'moby'] : ['docker', 'nerdctl', 'containerd'];
    } catch (e) {
      console.error(`Need to run rancher-desktop first`, e);
      skipTests = true;
    }
  });

  it('pushes and tests rancher/rancher with the first engine', async() => {
    // const imageName: 'nginx'|'rancher/rancher' = 'rancher/rancher';
    // let imageName: 'nginx' | 'rancher/rancher' = 'nginx';
    if (skipTests) {
      return;
    }
    await runAgainstContainerEngine(containerClient, 'rancher/rancher');
  });

  it('switches the containerEngine', async() => {
    if (skipTests) {
      return;
    }
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
        await sleepItOff(10);
      }
    }
  });

  it('pushes and tests rancher/rancher with the second engine', async() => {
    if (skipTests) {
      return;
    }
    await runAgainstContainerEngine(otherContainerClient, 'rancher/rancher');
  });

  it('flips kubernetes status', async() => {
    if (skipTests) {
      return;
    }
    const stdout = await tool('rdctl', 'list-settings');
    const settings = JSON.parse(stdout);

    const containerEngine = settings.kubernetes.containerEngine;
    const containerClient = containerEngine === ContainerEngine.CONTAINERD ? 'nerdctl' : 'docker';
    await tool('rdctl', 'set', `--kubernetes-enabled=${ !kubernetesStatus }`);
    await childProcess.spawnFile('sleep', ['10']);
    let i = 0;
    const limit = 60;

    // Just wait for the container engine to come up before continuing
    for (; i < limit; i++) {
      try {
        await tool(otherContainerClient, 'ps');
        break;
      } catch (e) {
        await sleepItOff(10);
      }
    }
  });

  it('pushes and tests rancher/rancher with other container-client and opposite kubernetes status', async() => {
    // const imageName: 'nginx'|'rancher/rancher' = 'rancher/rancher';
    // let imageName: 'nginx' | 'rancher/rancher' = 'nginx';
    if (skipTests) {
      return;
    }
    await runAgainstContainerEngine(otherContainerClient, 'rancher/rancher');
  });

  it('switches the containerEngine', async() => {
    if (skipTests) {
      return;
    }
    await tool('rdctl', 'set', '--container-engine', containerEngine.toString());
    await childProcess.spawnFile('sleep', ['10']);
    let i = 0;
    const limit = 60;

    // Just wait for the container engine to come up before continuing
    for (; i < limit; i++) {
      try {
        await tool(otherContainerClient, 'ps');
        break;
      } catch (e) {
        await sleepItOff(10);
      }
    }
  });

  it('pushes and tests rancher/rancher with the first engine and opposite kubernetes status', async() => {
    if (skipTests) {
      return;
    }
    await runAgainstContainerEngine(containerClient, 'rancher/rancher');
  });
});
