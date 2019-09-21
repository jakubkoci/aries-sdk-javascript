/* eslint-disable no-console */
/* eslint-disable @typescript-eslint/no-var-requires */
const { get, post } = require('../http');
const { poll } = require('../polling');
const { Agent } = require('../agent/Agent');
const { decodeInvitationFromUrl } = require('../helpers');
const { toBeConnectedWith } = require('../agent/__tests__/utils');

jest.setTimeout(10000);

expect.extend({ toBeConnectedWith });

const aliceConfig = {
  label: 'e2e Alice',
  walletId: 'e2e-alice',
  walletSeed: '00000000000000000000000000000Test01',
};

const bobConfig = {
  label: 'e2e Bob',
  walletId: 'e2e-bob',
  walletSeed: '00000000000000000000000000000Test02',
};

describe('with agency', () => {
  let aliceAgent;
  let bobAgent;

  test('make a connection with agency', async () => {
    const agencyUrl = `http://localhost:3000`;
    const aliceAgentSender = new HttpMessageSender(agencyUrl);
    const bobAgentSender = new HttpMessageSender(agencyUrl);

    aliceAgent = new Agent(aliceConfig, aliceAgentSender);
    await aliceAgent.init();

    bobAgent = new Agent(bobConfig, bobAgentSender);
    await bobAgent.init();

    const aliceAgencyInvitationUrl = await get(`${agencyUrl}/invitation`);
    const aliceKeyAtAliceAgency = await aliceAgent.acceptInvitationUrl(aliceAgencyInvitationUrl);

    const bobAgencyInvitationUrl = await get(`${agencyUrl}/invitation`);
    const bobKeyAtBobAgency = await bobAgent.acceptInvitationUrl(bobAgencyInvitationUrl);

    pollMessages(aliceAgent, agencyUrl, aliceKeyAtAliceAgency);
    pollMessages(bobAgent, agencyUrl, bobKeyAtBobAgency);

    const aliceConnectionAtAliceAgency = await poll(
      () => aliceAgent.findConnectionByMyKey(aliceKeyAtAliceAgency),
      connection => connection.state !== 4,
      200
    );
    console.log('aliceConnectionAtAliceAgency\n', aliceConnectionAtAliceAgency);

    const bobConnectionAtBobAgency = await poll(
      () => bobAgent.findConnectionByMyKey(bobKeyAtBobAgency),
      connection => connection.state !== 4,
      200
    );
    console.log('bobConnectionAtBobAgency\n', bobConnectionAtBobAgency);

    // TODO This endpoint currently exists at agency only for the testing purpose. It returns agency part of the pairwise connection.
    const agencyConnectionAtAliceAgency = JSON.parse(
      await get(`${agencyUrl}/api/connections/${aliceKeyAtAliceAgency}`)
    );
    const agencyConnectionAtBobAgency = JSON.parse(await get(`${agencyUrl}/api/connections/${bobKeyAtBobAgency}`));

    const { verkey: agencyVerkey } = JSON.parse(await get(`${agencyUrl}/`));
    aliceAgent.setAgency(agencyVerkey, aliceConnectionAtAliceAgency);
    bobAgent.setAgency(agencyVerkey, bobConnectionAtBobAgency);

    expect(aliceConnectionAtAliceAgency).toBeConnectedWith(agencyConnectionAtAliceAgency);
    expect(bobConnectionAtBobAgency).toBeConnectedWith(agencyConnectionAtBobAgency);
  });

  test('make a connection via agency', async () => {
    const invitationUrl = await aliceAgent.createInvitationUrl();
    await bobAgent.acceptInvitationUrl(invitationUrl);

    // We need to decode invitation URL to get keys from invitation
    // It can be maybe better to get connection ID instead of invitationUrl from the previous step and work with that
    const invitation = decodeInvitationFromUrl(invitationUrl);
    const aliceKeyAtAliceBob = invitation.recipientKeys[0];

    const aliceConnectionAtAliceBob = await poll(
      () => aliceAgent.findConnectionByMyKey(aliceKeyAtAliceBob),
      connection => connection.state !== 4,
      200
    );
    console.log('aliceConnectionAtAliceBob\n', aliceConnectionAtAliceBob);

    const bobKeyAtBobAlice = aliceConnectionAtAliceBob.theirKey;
    const bobConnectionAtBobAlice = await poll(
      () => bobAgent.findConnectionByMyKey(bobKeyAtBobAlice),
      connection => connection.state !== 4,
      200
    );
    console.log('bobConnectionAtAliceBob\n', bobConnectionAtBobAlice);

    expect(aliceConnectionAtAliceBob).toBeConnectedWith(bobConnectionAtBobAlice);
    expect(bobConnectionAtBobAlice).toBeConnectedWith(aliceConnectionAtAliceBob);
  });

  test('send a message to connection', async () => {
    const aliceConnections = await aliceAgent.getConnections();
    console.log('aliceConnections', aliceConnections);

    const bobConnections = await bobAgent.getConnections();
    console.log('bobConnections', bobConnections);

    // send message from Alice to Bob
    const message = 'hello, world';
    await aliceAgent.sendMessageToConnection(aliceConnections[1], message);

    const bobMessages = await poll(
      () => {
        console.log(`Getting Bob's connection messages...`);
        const connections = bobAgent.getConnections();
        return connections[1].messages;
      },
      messages => messages.length < 1
    );
    console.log(bobMessages);
    expect(bobMessages[0].content).toBe(message);
  });
});

function pollMessages(agent, agencyUrl, verkey) {
  poll(
    async () => {
      const message = await get(`${agencyUrl}/api/connections/${verkey}/message`);
      if (message && message.length > 0) {
        agent.receiveMessage(JSON.parse(message));
      }
    },
    () => true,
    1000
  );
}

class HttpMessageSender {
  constructor(endpoint) {
    this.endpoint = endpoint;
  }

  async sendMessage(message) {
    console.log('Sending message...');
    console.log(message);
    await post(`${this.endpoint}/msg`, JSON.stringify(message));
  }
}
