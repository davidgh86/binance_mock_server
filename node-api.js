const SocketServer = require('ws').Server;
var express = require('express');
var path = require('path');
var connectedUsers = [];
const lineByLine = require('n-readlines');
const { v4: uuidv4 } = require('uuid');

let current_open;
let current_close;
let current_low;
let current_high;
let current_price;

let orderList = []
let orderListOCO = []

let current_order_id = 0
let current_order_list_id = 0

let current_balance = 1000;
let usdt_balance = 1000000000;

const liner = new lineByLine('20192020.csv');
console.log(liner.next().toString('utf-8'))

//init Express
var app = express();
//init Express Router
var router = express.Router();
var port = process.env.PORT || 80;
//return static page with websocket client
app.get('/api/v3/account', function(req, res) {
    res.send({
        balances: [
            {
                asset: "BTC",
                free: current_balance
            }
        ]
    })
});

app.post('/api/v3/order', function(req, res) {
    let params = req.query
    if ((params.side === "SELL" && params.price > current_price) || (params.side === "BUY" && params.price < current_price)) {
      response = {
        code: -2010,
        msg: "Order would trigger immediately."
      }
      res.status(400).send(response)
    }else{
      let order = {
        symbol: params.symbol,
        orderId: current_order_id,
        orderListId: -1, 
        clientOrderId: uuidv4(),
        transactTime: getMilliseconds(), //1507725176595,
        price: params.price,
        origQty: params.quantity,
        executedQty: "0",
        cummulativeQuoteQty: "10.00000000",
        status: "NEW",
        timeInForce: params.timeInForce,
        type: params.type,
        side: params.side
      }
      orderList.push(order)
      current_order_id = current_order_id + 1
      res.send({
        symbol: order.symbol,
        orderId: order.orderId,
        orderListId: order.orderListId,
        clientOrderId: order.clientOrderId,
        transactTime: order.transactTime
      })
    }
});

app.get('/api/v3/order', function(req, res) {
  let params = req.query
  let orderId = params.orderId
  let order = getOrderFromList(orderId)
  res.send(order)
});

app.post('/api/v3/order/oco', function(req, res) {
    let params = req.query

    let orderId1 = uuidv4()
    let orderId2 = uuidv4()

    let clientId = uuidv4()

    let transactTime = getMilliseconds()

    // TODO finish
    let order = {
        orderListId: current_order_list_id,
        contingencyType: "OCO",
        listStatusType: "EXEC_STARTED",
        listOrderStatus: "EXECUTING",
        listClientOrderId: clientId,
        transactionTime: transactTime,
        symbol: params.symbol,
        orders: [
          {
            symbol: params.symbol,
            orderId: current_order_id,
            clientOrderId: orderId1
          },
          {
            symbol: params.symbol,
            orderId: current_order_id+1,
            clientOrderId: orderId2
          }
        ],
        orderReports: [
          {
            symbol: params.symbol,
            orderId: current_order_id,
            orderListId: current_order_list_id,
            clientOrderId: orderId1,
            transactTime: transactTime,
            price: params.stopLimitPrice,
            origQty: params.quantity,
            executedQty: 0.0,
            cummulativeQuoteQty: 0.0,
            status: "NEW",
            timeInForce: "GTC",
            type: "STOP_LOSS_LIMIT",
            side: params.side,
            stopPrice: params.stopPrice
          },
          {
            symbol: params.symbol,
            orderId: current_order_id+1,
            orderListId: current_order_list_id,
            clientOrderId: orderId2,
            transactTime: transactTime,
            price: params.price,
            origQty: params.quantity,
            executedQty: 0.0,
            cummulativeQuoteQty: 0.0,
            status: "NEW",
            timeInForce: "GTC",
            type: "LIMIT_MAKER",
            side: params.side
          }
        ]
      }
    orderListOCO.push(order)
    current_order_id = current_order_id + 2
    res.send(order)
});

app.get('/api/v3/allOrders', function(req, res) {
   // TODO
});

app.get('/api/v3/openOrders', function(req, res) {
  // TODO
});


function updateOrders(){
  for (let i = 0; i<orderList.length; i++){
    let updatedOrder = updateOrder(orderList[i])
    orderList[i] = updatedOrder
  }
}

function updateOrder(order){
  // TODO
}

function updateOCOOrder(order){
  // TODO
}

function updateOCOOrders(){
  for (let i = 0; i<orderListOCO; i++){
    let updatedOrder = updateOCOOrder(orderListOCO[i])
    orderListOCO[i] = updatedOrder
  }
}

var server = app.listen(port, function () {
    console.log('node.js static server listening on port: ' + port + ", with websockets listener")
})

const wss = new SocketServer({ 
    server: server,
    path: '/ws/btcusdt@kline_1m'
 });
//init Websocket ws and handle incoming connect requests
wss.on('connection', function connection(ws) {

    let line;
    
    setInterval(()=> {
        line = liner.next().toString('utf-8')
        fields = line.split(",")
        parts = fields[0].match(/(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
        date = Date.UTC(+parts[1], parts[2]-1, +parts[3], +parts[4], +parts[5], +parts[6])

        current_open = parseFloat(fields[1])
        current_close = parseFloat(fields[4])
        current_high = parseFloat(fields[2])
        current_low = parseFloat(fields[3])
    
        fields_json = {
            k: {
                t: date,
                o: current_open,
                c: current_close,
                h: current_high,
                l: current_low
            }
        }
        ws.send(JSON.stringify(fields_json));
    }, 2000);
});

function getMilliseconds(){
    const now = new Date()  
    const secondsSinceEpoch = Math.round(now.getTime()) 
    return secondsSinceEpoch
}