const SocketServer = require('ws').Server;
var express = require('express');
var path = require('path');
var connectedUsers = [];
const lineByLine = require('n-readlines');
const { v4: uuidv4 } = require('uuid');

const filled_probabilty = 0.90

let current_date = null;
let current_open = null;
let current_close = null;
let current_low = null;
let current_high = null;
let current_price = null;

let previous_date = null;
let previous_open = null;
let previous_close = null;
let previous_low = null;
let previous_high = null;

let orderList = []
let orderListOCO = []

let current_order_id = 0
let current_order_list_id = 0

let last_index_requested_orders = 0
let last_index_requested_oco_orders = 0

let current_balance = 10000;
let usdt_balance = 100000000;

const liner = new lineByLine('20192020.csv');
// initialize values from first two lines
liner.next().toString('utf-8')
updateCandlestickValues(liner.next().toString('utf-8'))
updateCandlestickValues(liner.next().toString('utf-8'))

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
      },
      {
        asset: "USDT",
        free: usdt_balance
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
        executedQty: 0.0,
        cummulativeQuoteQty: 10.0,
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
  
  
});

app.get('/api/v3/allOrderList', function(req, res) {
  let params = req.query
  let limit = 1000
  let startTime = 0
  let endTime = getMilliseconds()
  if (params.startTime){
    startTime = parseInt(params.startTime)
  }
  if (params.endTime){
    endTime = parseInt(params.endTime)
  }
  if (params.limit){
    limit = parseInt(params.limit)
  }
  result = orderListOCO.filter(order => (order.transactionTime>=startTime && order.transactionTime<=endTime))
  if (result.length > limit){
    res.send(result.slice(-1 * limit))
  }else{
    res.send(result)
  }
});

app.get('/api/v3/openOrders', function(req, res) {
  // TODO
});

function updateOCOAndOrdinary() {
  updateOCOOrders()
  updateOrders()
}

function updateOrders(){
  for (let i = 0; i<orderList.length; i++){
    let updatedOrder = updateOrder(orderList[i])
    orderList[i] = updatedOrder
  }
}

function transfer(side, size, price){
  let usdt_amount = size*price
  if (side == "SELL"){
    if (current_balance >= size){
      current_balance -= size;
      usdt_balance += usdt_amount;
      return true
    }
  }else if(side == "BUY"){
    if (usdt_balance >= usdt_amount){
      current_balance += size;
      usdt_balance -= usdt_amount;
      return true
    }
  }
  return false
}

function updateOrder(order){
  let result = order

  let order_status = order.status
  let order_executed_qty = order.executedQty

  if (order_status == "NEW"){
    if (order.side == "BUY"){
      if (current_high > order.price){
        let rand = Math.random()
        if (rand < filled_probabilty){
          if (transfer(order.side, order.origQty, order.price)){
            order_status = "FILLED"
            order_executed_qty = order.origQty
          }
        }else {
          let cuant_to_exec = Math.random() * order.origQty
          if (transfer(order.side, cuant_to_exec, current_price)){
            order_status = "PARTIALLY_FILLED"
            order_executed_qty = Math.random() * order.origQty
          }
        }
      }
    } else if(order.side == "SELL"){
      if (current_low < order.price){
        let rand = Math.random()
        if (rand < filled_probabilty){
          if (transfer(order.side, order.origQty, order.price)){
            order_status = "FILLED"
            order_executed_qty = order.origQty
          }
        }else {
          let cuant_to_exec = Math.random() * order.origQty
          if (transfer(order.side, cuant_to_exec, current_price)){
            order_status = "PARTIALLY_FILLED"
            order_executed_qty = Math.random() * order.origQty
          }
        }
      }
    }
  } else if (order_status == "PARTIALLY_FILLED"){
    if (rand < filled_probabilty){
      let qty_to_fill = order.origQty - order.executedQty
      if (transfer(order.side, qty_to_fill, current_price)){
        order_status = "FILLED"
        order_executed_qty = order.origQty
      }
    }else {
      let remaining_qty_to_fill = order.origQty - order.executedQty
      let qty_to_fill = Math.random() * remaining_qty_to_fill
      if (transfer(order.side, qty_to_fill, current_price)){
        order_status = "PARTIALLY_FILLED"
        order_executed_qty = order.executedQty + qty_to_fill
      }
    }
  }

  result.status = order_status
  result.executedQty = order_executed_qty

  return result
}

function updateOCOOrder(order){
  let side = order.orderReports[0].side
  if (order.orderReports[0].side == "SELL"){
    let limit = order.orderReports[1].price
    let stop = order.orderReports[0].price
    if (order.orderReports[0].status == "NEW") {
      if (current_low <= limit) {
        if (Math.random() < filled_probabilty){
          order.orderReports[1].status = "FILLED"
          order.orderReports[1].executedQty = order.orderReports[1].origQty
        }else{
          let qty = Math.random() * order.orderReports[1].origQty
          if (transfer(side, qty, limit)) {
            order.orderReports[1].status = "PARTIALLY_FILLED"
            order.orderReports[1].executedQty = qty
          }
        }
        order.orderReports[0].status = "CANCELED"
      }else if(current_high >= stop){
        order.orderReports[1].status = "CANCELED"
        if (Math.random() < filled_probabilty){
          order.orderReports[0].status = "FILLED"
          order.orderReports[0].executedQty = order.orderReports[0].origQty
        }else{
          let qty = Math.random() * order.orderReports[0].origQty
          if (transfer(side, qty, stop)) {
            order.orderReports[0].status = "PARTIALLY_FILLED"
            order.orderReports[0].executedQty = Math.random() * order.orderReports[0].origQty
          }
        }
      }
    }
  }else if(order.orderReports[0].side == "BUY"){
    let limit = order.orderReports[1].price
    let stop = order.orderReports[0].price
    if (order.orderReports[0].status == "NEW") {
      if (current_high >= limit){
        if (Math.random() < filled_probabilty){
          order.orderReports[1].status = "FILLED"
          order.orderReports[1].executedQty = order.orderReports[1].origQty
        }else{
          let qty = Math.random() * order.orderReports[1].origQty
          if (transfer(side, qty, limit)) {
            order.orderReports[1].status = "PARTIALLY_FILLED"
            order.orderReports[1].executedQty = Math.random() * order.orderReports[1].origQty
          }
        }
        order.orderReports[0].status = "CANCELED"
      }else if(current_low <= stop){
        order.orderReports[1].status = "CANCELED"
        if (Math.random() < filled_probabilty){
          order.orderReports[0].status = "FILLED"
          order.orderReports[0].executedQty = order.orderReports[0].origQty
        }else{
          let qty = Math.random() * order.orderReports[0].origQty
          if (transfer(side, qty, stop)) {
            order.orderReports[0].status = "PARTIALLY_FILLED"
            order.orderReports[0].executedQty = Math.random() * order.orderReports[1].origQty
          }
        }
      }
    }
  }
  if(order.orderReports[0].status = "PARTIALLY_FILLED"){
    let remaining_qty = order.orderReports[0].origQty - order.orderReports[0].executedQty
    if (Math.random() < filled_probabilty){
      if (transfer(side, remaining_qty, current_price)){
        order.orderReports[0].status = "FILLED"
        order.orderReports[0].executedQty = order.orderReports[0].origQty
      }
    }else{
      let qty = Math.random() * remaining_qty
      if (transfer(side, qty, current_price)){
        order.orderReports[0].status = "PARTIALLY_FILLED"
        order.orderReports[0].executedQty = order.orderReports[0].executedQty + qty
      }
    }
  }
  if(order.orderReports[1].status = "PARTIALLY_FILLED"){
    let remaining_qty = order.orderReports[1].origQty - order.orderReports[1].executedQty
    if (Math.random() < filled_probabilty){
      if (transfer(side, remaining_qty, current_price)){
        order.orderReports[1].status = "FILLED"
        order.orderReports[1].executedQty = order.orderReports[1].origQty
      }
    }else{
      let qty = Math.random() * remaining_qty
      if (transfer(side, qty, current_price)){
        order.orderReports[1].status = "PARTIALLY_FILLED"
        order.orderReports[1].executedQty = order.orderReports[1].executedQty + qty
      }
    }
  }
  return order
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

        updateCandlestickValues(line)
        updateOCOAndOrdinary()

        fields_json = {
            k: {
                t: previous_date,
                o: previous_open,
                c: previous_close,
                h: previous_high,
                l: previous_low
            }
        }
        ws.send(JSON.stringify(fields_json));
    }, 2000);
});

function updateCandlestickValues(line) {
  previous_date = current_date
  fields = line.split(",")
  parts = fields[0].match(/(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  current_date = Date.UTC(+parts[1], parts[2]-1, +parts[3], +parts[4], +parts[5], +parts[6])

  previous_close = current_close
  previous_open = current_open
  previous_high = current_high
  previous_low = current_low

  current_open = parseFloat(fields[1])
  current_close = parseFloat(fields[4])
  current_high = parseFloat(fields[2])
  current_low = parseFloat(fields[3])

  previous_price = current_price
  current_price = Math.random() * (current_high - current_low) + current_low;
}

function getMilliseconds(){
    const now = new Date()  
    const secondsSinceEpoch = Math.round(now.getTime()) 
    return secondsSinceEpoch
}