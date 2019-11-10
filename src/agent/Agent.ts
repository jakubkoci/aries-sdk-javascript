import logger from '../logger';
import { Connection, OutboundMessage, InitConfig, Handler, OutboundTransporter } from './types';
import { encodeInvitationToUrl, decodeInvitationFromUrl } from './helpers';
import { IndyWallet } from './Wallet';
import {
  handleInvitation,
  handleConnectionRequest,
  handleConnectionResponse,
  handleAckMessage,
} from './messaging/connections/handlers';
import { ConnectionService } from './messaging/connections/ConnectionService';
import { MessageType as ConnectionsMessageType } from './messaging/connections/messages';
import { handleBasicMessage } from './messaging/basicmessage/handlers';
import { MessageType as BasicMessageMessageType } from './messaging/basicmessage/messages';
import { handleForwardMessage, handleRouteUpdateMessage } from './messaging/routing/handlers';
import { MessageType as RoutingMessageType } from './messaging/routing/messages';
import { ProviderRoutingService } from './messaging/routing/ProviderRoutingService';
import { Context } from './Context';
import { BasicMessageService } from './messaging/basicmessage/BasicMessageService';
import { MessageSender } from './MessageSender';
import { ConsumerRoutingService } from './messaging/routing/ConsumerRoutingService';

class Agent {
  context: Context;
  connectionService: ConnectionService;
  basicMessageService: BasicMessageService;
  providerRoutingService: ProviderRoutingService;
  consumerRoutingService: ConsumerRoutingService;
  handlers: { [key: string]: Handler } = {};

  constructor(config: InitConfig, outboundTransporter: OutboundTransporter) {
    logger.logJson('Creating agent with config', config);

    const wallet = new IndyWallet({ id: config.walletName }, { key: config.walletKey });
    const messageSender = new MessageSender(wallet, outboundTransporter);

    this.context = {
      config,
      wallet,
      messageSender,
    };

    this.connectionService = new ConnectionService(this.context);
    this.basicMessageService = new BasicMessageService();
    this.providerRoutingService = new ProviderRoutingService();
    this.consumerRoutingService = new ConsumerRoutingService(this.context);

    this.registerHandlers();
  }

  async init() {
    await this.context.wallet.init();
  }

  /**
   * This method will be probably used only when agent is running as routing agency
   */
  async setAgentDid() {
    this.context.wallet.initPublicDid(this.context.config.publicDid, this.context.config.publicDidSeed);
  }

  /**
   * This method will be probably used only when agent is running as routing agency
   */
  getAgentDid() {
    return this.context.wallet.getPublicDid();
  }

  async createInvitationUrl() {
    const connection = await this.connectionService.createConnectionWithInvitation();
    const { invitation } = connection;

    if (!invitation) {
      throw new Error('Connection has no invitation assigned.');
    }

    // If agent is using agency, we need to create a route for newly created connection verkey at agency.
    if (this.context.agency) {
      this.consumerRoutingService.createRoute(connection.verkey);
    }

    return encodeInvitationToUrl(invitation);
  }

  async acceptInvitationUrl(invitationUrl: string) {
    const invitation = decodeInvitationFromUrl(invitationUrl);
    const verkey = await this.receiveMessage(invitation);
    return verkey;
  }

  async receiveMessage(inboundPackedMessage: any) {
    logger.logJson(`Agent ${this.context.config.label} received message:`, inboundPackedMessage);
    let inboundMessage;

    if (!inboundPackedMessage['@type']) {
      inboundMessage = await this.context.wallet.unpack(inboundPackedMessage);

      if (!inboundMessage.message['@type']) {
        // TODO In this case we assume we got forwarded JWE message (wire message?) to this agent from agency. We should
        // perhaps try to unpack message in some loop until we have a Aries message in here.
        logger.logJson('Forwarded message', inboundMessage);

        // @ts-ignore
        inboundMessage = await this.context.wallet.unpack(inboundMessage.message);
      }
    } else {
      inboundMessage = { message: inboundPackedMessage };
    }

    logger.logJson('inboundMessage', inboundMessage);
    const outboundMessage = await this.dispatch(inboundMessage);

    if (outboundMessage) {
      this.context.messageSender.sendMessage(outboundMessage);
    }

    return outboundMessage && outboundMessage.connection.verkey;
  }

  getConnections() {
    return this.connectionService.getConnections();
  }

  findConnectionByMyKey(verkey: Verkey) {
    return this.connectionService.findByVerkey(verkey);
  }

  findConnectionByTheirKey(verkey: Verkey) {
    return this.connectionService.findByTheirKey(verkey);
  }

  getRoutes() {
    return this.providerRoutingService.getRoutes();
  }

  setAgency(agencyVerkey: Verkey, connection: Connection) {
    this.context.agency = { verkey: agencyVerkey, connection };
  }

  async sendMessageToConnection(connection: Connection, message: string) {
    const outboundMessage = this.basicMessageService.send(message, connection);
    await this.context.messageSender.sendMessage(outboundMessage);
  }

  private async dispatch(inboundMessage: any): Promise<OutboundMessage | null> {
    const messageType: string = inboundMessage.message['@type'];
    const handler = this.handlers[messageType];

    if (!handler) {
      throw new Error(`No handler for message type "${messageType}" found`);
    }

    const outboundMessage = await handler(inboundMessage);
    return outboundMessage;
  }

  private registerHandlers() {
    const handlers = {
      [ConnectionsMessageType.ConnectionInvitation]: handleInvitation(
        this.connectionService,
        this.consumerRoutingService
      ),
      [ConnectionsMessageType.ConnectionRequest]: handleConnectionRequest(this.connectionService),
      [ConnectionsMessageType.ConnectionResposne]: handleConnectionResponse(this.connectionService),
      [ConnectionsMessageType.Ack]: handleAckMessage(this.connectionService),
      [BasicMessageMessageType.BasicMessage]: handleBasicMessage(this.connectionService, this.basicMessageService),
      [RoutingMessageType.RouteUpdateMessage]: handleRouteUpdateMessage(
        this.connectionService,
        this.providerRoutingService
      ),
      [RoutingMessageType.ForwardMessage]: handleForwardMessage(this.providerRoutingService),
    };

    this.handlers = handlers;
  }
}

export { Agent, OutboundTransporter };
