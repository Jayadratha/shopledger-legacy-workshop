'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');

var invoice = require('../lib/invoice');
var pricing = require('../lib/pricing');
var reports = require('../lib/reports');

function order(items, coupon, totals) {
  return Object.assign({
    id: 1,
    date: '01/04/2022',
    customer: 'In-memory customer',
    paymentMode: 'cash',
    status: 'completed',
    items: items,
    coupon: coupon || ''
  }, totals || {});
}

test('CURRENT BEHAVIOUR: order pricing applies HSN GST after proportional coupon discount', function () {
  var items = [
    { id: 1, sku: 'RICE', name: 'Rice', hsn: '1006', price: 100, qty: 1 },
    { id: 2, sku: 'BUTTER', name: 'Butter', hsn: '0405', price: 100, qty: 1 }
  ];

  var totals = pricing.computeTotals(items, 'WELCOME');

  assert.equal(totals.subtotal, 200);
  assert.equal(totals.discount, 10);
  assert.equal(totals.tax, 16.15);
  assert.equal(totals.total, 206.15);
  assert.deepEqual(totals.lines.map(function (line) {
    return { gstPercent: line.gstPercent, taxable: line.taxable, tax: line.tax };
  }), [
    { gstPercent: 5, taxable: 95, tax: 4.75 },
    { gstPercent: 12, taxable: 95, tax: 11.4 }
  ]);
});

test('invoice GST breakdown and total match order pricing for discounted HSN lines', function () {
  var items = [
    { id: 1, sku: 'RICE', name: 'Rice', hsn: '1006', price: 100, qty: 1 },
    { id: 2, sku: 'BUTTER', name: 'Butter', hsn: '0405', price: 100, qty: 1 }
  ];
  var billed = pricing.computeTotals(items, 'WELCOME');
  var invoiceFigures = invoice.computeInvoiceFigures(order(items, 'WELCOME', billed));

  assert.equal(invoiceFigures.subtotal, billed.subtotal);
  assert.equal(invoiceFigures.discount, billed.discount);
  assert.equal(invoiceFigures.tax, billed.tax);
  assert.equal(invoiceFigures.cgst, billed.cgst);
  assert.equal(invoiceFigures.sgst, billed.sgst);
  assert.equal(invoiceFigures.total, billed.total);
  assert.deepEqual(invoiceFigures.rows.map(function (line) {
    return { gstPercent: line.gstPercent, lineTax: line.lineTax };
  }), billed.lines.map(function (line) {
    return { gstPercent: line.gstPercent, lineTax: line.tax };
  }));
});

test('invoice uses order pricing HSN rates and apportioned coupon discount', function () {
  var items = [
    { id: 1, sku: 'RICE', name: 'Rice', hsn: '1006', price: 100, qty: 1 },
    { id: 2, sku: 'BUTTER', name: 'Butter', hsn: '0405', price: 100, qty: 1 }
  ];
  var priced = pricing.computeTotals(items, 'WELCOME');
  var invoiceFigures = invoice.computeInvoiceFigures(order(items, 'WELCOME', priced));

  assert.equal(invoiceFigures.subtotal, priced.subtotal);
  assert.equal(invoiceFigures.discount, priced.discount);
  assert.equal(invoiceFigures.tax, priced.tax);
  assert.equal(invoiceFigures.cgst, priced.cgst);
  assert.equal(invoiceFigures.sgst, priced.sgst);
  assert.equal(invoiceFigures.total, priced.total);
  assert.deepEqual(invoiceFigures.rows.map(function (line) {
    return { gstPercent: line.gstPercent, lineTax: line.lineTax };
  }), priced.lines.map(function (line) {
    return { gstPercent: line.gstPercent, lineTax: line.tax };
  }));
});

test('invoice honors SAVE10 maximum discount and matches billed HSN tax', function () {
  var items = [
    { id: 5, sku: 'OIL-002', name: 'Groundnut Oil', hsn: '1508', price: 1120, qty: 2 }
  ];
  var priced = pricing.computeTotals(items, 'SAVE10');
  var invoiceFigures = invoice.computeInvoiceFigures(order(items, 'SAVE10', priced));

  assert.equal(priced.subtotal, 2240);
  assert.equal(priced.discount, 150);
  assert.equal(priced.tax, 104.5);
  assert.equal(priced.total, 2194.5);
  assert.equal(invoiceFigures.tax, priced.tax);
  assert.equal(invoiceFigures.discount, priced.discount);
  assert.equal(invoiceFigures.total, priced.total);
});

test('GST reconciliation reports matching invoice totals and tax for active orders', function () {
  var items = [
    { id: 5, sku: 'OIL-002', name: 'Groundnut Oil', hsn: '1508', price: 1120, qty: 2 }
  ];
  var priced = pricing.computeTotals(items, 'SAVE10');
  var savedOrder = order(items, 'SAVE10', priced);
  var result = reports.getGstReconciliation({ orders: [savedOrder] });

  assert.equal(result.totalChecked, 1);
  assert.equal(result.mismatchCount, 0);
  assert.equal(result.totalDelta, 0);
  assert.equal(result.rows[0].ledgerTax, 104.5);
  assert.equal(result.rows[0].invoiceTax, 104.5);
  assert.equal(result.rows[0].delta, 0);
  assert.equal(result.rows[0].matched, true);
});

test('rendered invoice shows the billed HSN rate and total without a reconciliation notice', function () {
  var items = [
    { id: 5, sku: 'OIL-002', name: 'Groundnut Oil', hsn: '1508', price: 1120, qty: 2 }
  ];
  var priced = pricing.computeTotals(items, 'SAVE10');
  var html = invoice.render(order(items, 'SAVE10', priced));

  assert.match(html, /5%/);
  assert.match(html, /₹104\.50/);
  assert.match(html, /Invoice Total<\/td><td class="r">₹2194\.50/);
  assert.doesNotMatch(html, /differs from Order Ledger recorded total/);
});
