/* eslint-env node, mocha */

const sinon = require('sinon');
const assert = require('assert');
const KinesisStream = require('../');
const expect = require('chai').expect;

describe('KinesisStream', function() {
  describe('#constructor', function() {
    it('should throw if .streamName is not provided', function() {
      expect(function() {new KinesisStream({});}).to.throw(assert.AssertionError, /streamName/);
    });
    it('should build a stream with default configurations', function() {
      const ks = new KinesisStream({
        streamName: 'test',
        kinesis: {}
      });

      expect(ks.hasPriority).to.be.a('function');
      expect(ks.recordsQueue).to.exist;
      expect(ks.partitionKey).to.be.string;
    });
    it('should build a stream with configured endpoint and objectMode', function() {
      const ks = new KinesisStream({
        streamName: 'test',
        objectMode: true,
        kinesis: {
          endpoint: 'http://somehost:1234'
        }
      });

      expect(ks.hasPriority).to.be.a('function');
      expect(ks.recordsQueue).to.exist;
      expect(ks.partitionKey).to.be.a('function');
      expect(ks.kinesis.endpoint).to.equal('http://somehost:1234');
      expect(ks._writableState.objectMode).to.equal(true);
    });
  });
  describe('#_write', function() {
    var ks;
    const message = {test: true};
    beforeEach(function() {
      ks = new KinesisStream({
        streamName: 'test',
        kinesis: {}
      });
      ks.dispatch = sinon.spy();
    });
    it('should call immediately dispatch with a single message if it has priority', function() {
      ks.hasPriority = function() {
        return true;
      };
      ks.write(Buffer.from(JSON.stringify(message)));
      expect(ks.dispatch.calledOnce).to.be.true;
      expect(ks.dispatch.calledWith([message])).to.be.true;
    });
    it('should add message to queue if no priority was specified and add a timer', function() {
      ks.write(Buffer.from(JSON.stringify(message)));
      expect(ks.dispatch.calledOnce).to.be.false;
      expect(ks.timer).to.exist;
      expect(ks.recordsQueue.length).to.equal(1);
    });
    it('should add message to queue and call flush is size has crossed the threshold', function() {
      for (var i = 0; i < 10; i++) {
        ks.write(Buffer.from(JSON.stringify(message)));
      }
      expect(ks.dispatch.calledOnce).to.be.true;
      expect(ks.dispatch.calledWith([message, message, message, message, message, message, message, message, message, message])).to.be.true;
    });
    it('should call #dispatch once timer hits', function(done) {
      this.timeout(3000);
      ks.buffer.timeout = 1;
      // write one message to start timeout
      ks.write(Buffer.from(JSON.stringify(message)));
      // write another after 500ms.
      setTimeout(() => ks.write(Buffer.from(JSON.stringify(message))), 500);
      // write another after 750ms.
      setTimeout(() => ks.write(Buffer.from(JSON.stringify(message))), 750);
      // at 1100 ms timer should have fired still.
      setTimeout(function() {
        expect(ks.dispatch.calledOnce).to.be.true;
        expect(ks.dispatch.calledWith([message, message, message])).to.be.true;
      }, 1100);
      // and at 2 seconds it should not have fired again ...
      setTimeout(function() {
        expect(ks.dispatch.calledOnce).to.be.true;
        expect(ks.dispatch.calledWith([message, message, message])).to.be.true;
        done();
      }, 2000);
    });
  });
  describe('#flush', function() {
    it('should call #dispatch with at most buffer size', function() {
      const ks = new KinesisStream({
        streamName: 'test',
        kinesis: {}
      });
      ks.dispatch = sinon.spy();
      ks.recordsQueue = [1,2,3];
      ks.flush();
      expect(ks.dispatch.calledOnce).to.be.true;
      expect(ks.dispatch.calledWith([1,2,3])).to.be.true;
    });
  });
  describe('#dispatch', function() {
    var ks, kinesis = {};
    beforeEach(function() {
      ks = new KinesisStream({
        streamName: 'test',
        kinesis: kinesis
      });
    });
    it('should return immediately if no messages are provided', function(done) {
      kinesis.putRecords = sinon.spy();
      ks.dispatch([], function() {
        expect(kinesis.putRecords.calledOnce).to.be.false;
        done();
      });
    });
    it('should retry if #putRecords failed', function(done) {
      const message = {test: true};
      const stub = sinon.stub(ks, 'putRecords').callsFake(function(r, cb) {
        return cb(new Error());
      });

      ks.on('error', function(err) {
        expect(err).to.exist;
        expect(err.records.length).to.equal(2);
        expect(stub.calledThrice).to.be.true;
      });

      ks.dispatch([message, message], function(err) {
        expect(err).to.exist;
        done();
      });
    });

    it('should putRecords without error when record contains circular references', function() {
      const logMessage = (s) => { return s.getCall(0).args[0][0].Data; };
      ks.putRecords = sinon.spy();

      const message = {
        hi: 'hello'
      };
      message.message = message;

      ks.dispatch([message]);

      expect(ks.putRecords.calledOnce).to.be.true;
      expect('{"hi":"hello","message":"[Circular]"}').to.equal(logMessage(ks.putRecords));
    });
  });
});
