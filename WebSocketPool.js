import { eventChannel, delay } from 'redux-saga';
import uuidv4 from 'uuid/v4';
import { call, fork } from 'redux-saga/effects';

import { has } from '../../utils/utils';

export const SOCKET_CLOSED = 3;
export const SOCKET_CLOSING = 2;
export const SOCKET_OPEN = 1;
const KEEP_ALIVE_TIME_INTERVAL = 29000;
const MAX_NUMBEROF_SOCKETS = 10;

class WebSocketItem {
  constructor(socket, socketChannel, webSocketId, requests) {
    this.socket = socket;
    this.socketChannel = socketChannel;
    this.webSocketId = webSocketId;
    this.requests = requests;
  }
}

class WebSocketQueue {
  constructor() {
    this.items = [];
  }

    /*
     * enqueue function to add element
     * to the queue as per priority
     */
    enqueue = (webSocketItem) => {
      let contain = false;

      /*
       * find index through to add element at the
       * correct location of the Queue
       * so that queue is in ascending sort order
       * of number of requests
       */
      const index = this.items.findIndex(item =>
        item.requests.length > webSocketItem.requests.length);
      if (index > -1) {
        this.items.splice(index, 0, webSocketItem);
        contain = true;
      }

      /*
       * if the element have the highest number of requests
       * it is added at the end of the queue
       */
      if (!contain) {
        this.items.push(webSocketItem);
      }
    }


    // dequeue function
    dequeue = () => {
      /*
       * removing element from the queue
       * returns underflow when called
       * on empty queue
       */
      if (this.isEmpty()) { return 'Underflow'; }
      return this.items.shift();
    }

    // front function
    front = () => {
      /*
       * returns the Front element of
       * the queue without removing it.
       */
      if (this.isEmpty()) { return 'No elements in Queue'; }
      return this.items[0];
    }

    removeItem = (requestId) => {
      let webSocketItem = null;

      const webSocketItemIndex = this.items.findIndex(item => item.requests.includes(requestId));
      if (webSocketItemIndex > -1) {
        webSocketItem = this.items[webSocketItemIndex];
        this.items.splice(webSocketItemIndex, 1);
      }
      return webSocketItem;
    }

    // isEmpty function
    isEmpty = () =>
      // return true if the queue is empty.
      this.items.length === 0


    // size function
    size = () =>
      // return the length of items.
      this.items.length


    // rear function
    rear = () => {
      /*
       * returns the lowest priorty
       * element of the queue
       */
      if (this.isEmpty()) { return 'No elements in Queue'; }
      return this.items[this.items.length - 1];
    }

    clear = () => {
      this.items.splice(0, this.items.length);
    }

    // printQueue function
    printQueue = () => {
      let str = '';
      this.items.forEach((item) => { str += `WebSocket: ${item.webSocketId} with requests: ${item.requests}\n`; });
      return str;
    }

    createWebSocketAsPromised = (isBroadCast = false) => {
      if (this.items.length >= MAX_NUMBEROF_SOCKETS) {
        return Promise.reject(new Error('Maximum limit for WebSockets reached.'));
      }

      return new Promise(((resolve, reject) => {
        const clarityURI = `${window.location.host}`;
        const webSocketId = `${uuidv4()}`;
        const socket = new WebSocket(
          `wss://${clarityURI}/ws/clarity?websocketId=${webSocketId}`,
        );

        // First eventChannel param is a subscribe function
        const socketChannel = eventChannel((emitter) => {
          const listener = (event) => {
            if (event.data) {
              emitter(JSON.parse(event.data));
            }
          };

          socket.onmessage = listener;
          socket.onerror = listener;

          const unsubscribe = () => {
            socket.close();
          };

          return unsubscribe;
        });

        const socketObj = new WebSocketItem(socket, socketChannel, webSocketId, []);

        socket.onopen = function () {
          console.log(`Socket for --> pool  and socketId --> ${webSocketId}`);
          setInterval(() => {
            if (socket.readyState === SOCKET_OPEN) {
              socket.send('Keep alive');
            }
          }, KEEP_ALIVE_TIME_INTERVAL);
          resolve(socketObj);
        };


        socket.onerror = function (error) {
          console.error('WebSocketPoolError: socket connection error : ', error);
          reject(error);
        };
      }));
    }
}


export class WebSocketPool {
  constructor() {
    this.webSocketQueue = new WebSocketQueue();
    this.broadcastSocket = null;
  }

    // createWebSocket creates and returns the websocket
    createWebSocket = (isBroadCast = false) =>
      this.webSocketQueue.createWebSocketAsPromised(isBroadCast)
        .then(socketObj => socketObj)
        .catch(error => ({ error: `WebSocketPoolError:${error}` }));

    // getWebSocket (requestId) returns the next available websocket
    getWebSocket = (requestId, fName) => {
      try {
        const {
          socket, socketChannel, webSocketId, requests,
        } = this.webSocketQueue.dequeue();
        this.webSocketQueue.enqueue({
          socket, socketChannel, webSocketId, requests: [requestId, ...requests],
        });
        console.log(`WebSocketPool: allocated request: ${requestId} for ${fName} to webSocket = ${webSocketId} at: ${new Date()}`);
        console.log(`WebSocketPool - printqueue \n: ${this.webSocketQueue.printQueue()}`);
        return {
          socket, socketChannel, webSocketId, requests,
        };
      } catch (err) {
        console.log(`WebSocketPoolError:${err}`);
        return { webSocketId: null };
      }
    }

    // removeRequestsFromWebSocket (requestId)
    removeRequestsFromWebSocket = (requestId) => {
      try {
        const webSocketItem = this.webSocketQueue.removeItem(requestId);

        if (webSocketItem != null) {
          const {
            socket, socketChannel, webSocketId, requests,
          } = webSocketItem;
          // remove the request from webSocket requests and enqueue it back in the queue
          const index = requests.indexOf(requestId);
          if (index > -1) {
            requests.splice(index, 1);
          }
          this.webSocketQueue.enqueue({
            socket, socketChannel, webSocketId, requests,
          });
          console.log(`WebSocketPool: removed request: ${requestId} from webSocket = ${webSocketId} at: ${new Date()}`);
          console.log(`WebSocketPool - after removing printqueue\n: ${this.webSocketQueue.printQueue()}`);
        } else {
          console.log(`WebSocketPoolError: The requestId is already deleted from webSocket requests ${requestId}`);
        }
      } catch (err) {
        console.log(`WebSocketPoolError:${err}`);
      }
    }

    // closeWebSocket (webSocket)
    clearWebSocketPool = () => {
      // close each websocket first
      this.webSocketQueue.items.forEach((webSocketItem) => {
        if (webSocketItem.socket.readyState !== SOCKET_CLOSED ||
                webSocketItem.socket.readyState !== SOCKET_CLOSING) {
          console.log(`Closing socket for - ${webSocketItem.webSocketId}`);
          webSocketItem.socket.close();
        }
      });

      // clear the items from queue
      this.webSocketQueue.clear();
    }
}

export const BusinessWebSocketPool = new WebSocketPool();

export function* createWebSocketPool(fnwatchWebSocketPoolMessages) {
  if (BusinessWebSocketPool.webSocketQueue.size() < MAX_NUMBEROF_SOCKETS) {
    for (let i = 0; i < MAX_NUMBEROF_SOCKETS; i += 1) {
      if (i % 3 === 0) {
        /**
         * add delay of 2 seconds after every 3 websockets
         * so other requests pending in the queue
         */
        yield delay(2000);
      }
      const timeStart = new Date();
      const socketItem = yield call(BusinessWebSocketPool.createWebSocket);
      if (has(socketItem, 'WebSocketPoolError') || socketItem === undefined) {
        throw Error(socketItem);
      }
      console.log(socketItem);
      BusinessWebSocketPool.webSocketQueue.enqueue(socketItem);
      const { socketChannel } = socketItem;
      const timeEnd = new Date();
      console.log(`Time taken for socket creation for ${i} - ${timeEnd.getTime() - timeStart.getTime()}ms`);
      yield fork(fnwatchWebSocketPoolMessages, socketChannel);
    }
  }
  console.log(`WebSocketPool - printqueue\n:${BusinessWebSocketPool.webSocketQueue.printQueue()}`);
}
