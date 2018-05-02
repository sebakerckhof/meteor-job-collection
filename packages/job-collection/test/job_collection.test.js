/*
 * decaffeinate suggestions:
 * DS102: Remove unnecessary code created because of implicit returns
 * DS202: Simplify dynamic range loops
 * DS205: Consider reworking code to avoid use of IIFEs
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
let remoteServerTestColl;
import { assert } from 'chai';

//###########################################################################
//     Copyright (C) 2014-2017 by Vaughn Iverson
//     job-collection is free software released under the MIT/X11 license.
//     See included LICENSE file for details.
//###########################################################################

const bind_env = function(func) {
  if (Meteor.isServer && (typeof func === 'function')) {
    return Meteor.bindEnvironment(func, function(err) { throw err; });
  } else {
    return func;
  }
};

const subWrapper = (sub, func) =>
  function(test, onComplete) {
    if (Meteor.isClient) {
      return Deps.autorun(function() {
        if (sub.ready()) {
          return func(test, onComplete);
        }
      });
    } else {
      return func(test, onComplete);
    }
  }
;

const validId = v => Match.test(v, Match.OneOf(String, Meteor.Collection.ObjectID));

const defaultColl = new JobCollection();

const validJobDoc = d => Match.test(d, defaultColl.jobDocPattern);

it('JobCollection constructs the object correctly', function() {
  assert.instanceOf(defaultColl, JobCollection, "JobCollection constructor failed");
  assert.equal(defaultColl.root, 'queue', "default root isn't 'queue'");
  if (Meteor.isServer) {
    assert.equal(defaultColl.stopped, true, "isn't initially stopped");
    assert.equal(defaultColl.logStream, null, "Doesn't have a logStream");
    assert.instanceOf(defaultColl.allows, Object, "allows isn't an object");
    assert.equal(Object.keys(defaultColl.allows).length, 22, "allows not properly initialized");
    assert.instanceOf(defaultColl.denys, Object, "denys isn't an object");
    return assert.equal(Object.keys(defaultColl.denys).length, 22, "denys not properly initialized");
  } else {
    return assert.equal(defaultColl.logConsole, false, "Doesn't have a logConsole");
  }
});

const clientTestColl = new JobCollection('ClientTest', { idGeneration: 'MONGO' });
const serverTestColl = new JobCollection('ServerTest', { idGeneration: 'STRING' });

// The line below is a regression test for issue #51
const dummyTestColl = new JobCollection('DummyTest', { idGeneration: 'STRING' });

if (Meteor.isServer) {
  const remoteTestColl = new JobCollection('RemoteTest', { idGeneration: 'STRING' });
  remoteTestColl.allow({
    admin() { return true; }});
} else {
  const remoteConnection = DDP.connect(Meteor.absoluteUrl());
  remoteServerTestColl = new JobCollection('RemoteTest', { idGeneration: 'STRING', connection: remoteConnection });
}

let testColl = null;  // This will be defined differently for client / server

if (Meteor.isServer) {

  clientTestColl.allow({
    admin() { return true; }});

  it('Set permissions to allow admin on ClientTest', () => assert.equal(clientTestColl.allows.admin[0](), true));

  it('Set polling interval', function() {
    let { interval } = clientTestColl;
    clientTestColl.promote(250);
    assert.notEqual(interval, clientTestColl.interval, "clientTestColl interval not updated");
    ({ interval } = serverTestColl);
    serverTestColl.promote(250);
    return assert.notEqual(interval, serverTestColl.interval, "serverTestColl interval not updated");
  });
}

testColl = Meteor.isClient ? clientTestColl : serverTestColl;

// it 'Run startJobs on new job collection', (onComplete) ->
//   testColl.startJobs (err, res) ->
//     assert.fail(err) if err
//     assert.equal res, true, "startJobs failed in callback result"
//     if Meteor.isServer
//       assert.equal testColl.stopped, false, "startJobs didn't start job collection"
//     onComplete()

it('Run startJobServer on new job collection', onComplete =>
  testColl.startJobServer(function(err, res) {
    if (err) { assert.fail(err); }
    assert.equal(res, true, "startJobServer failed in callback result");
    if (Meteor.isServer) {
      assert.equal(testColl.stopped, false, "startJobServer didn't start job collection");
    }
    return onComplete();
  })
);

if (Meteor.isServer) {

  it('Create a server-side job and see that it is added to the collection and runs', function(onComplete) {
    let ev;
    const jobType = `TestJob_${Math.round(Math.random()*1000000000)}`;
    const job = new Job(testColl, jobType, { some: 'data' });
    assert.ok(validJobDoc(job.doc));
    const res = job.save();
    assert.ok(validId(res), "job.save() failed in sync result");
    const q = testColl.processJobs(jobType, { pollInterval: 250 }, function(job, cb) {
      assert.equal(job._doc._id, res);
      job.done();
      return cb();
    });
    return ev = testColl.events.once('jobDone', function(msg) {
      assert.equal(msg.method, 'jobDone');
      if (msg.params[0] === res) {
        return q.shutdown({ level: 'soft', quiet: true }, () => onComplete());
      }
    });
  });
}

it('Create a job and see that it is added to the collection and runs', function(onComplete) {
  const jobType = `TestJob_${Math.round(Math.random()*1000000000)}`;
  const job = new Job(testColl, jobType, { some: 'data' });
  assert.ok(validJobDoc(job.doc));
  return job.save(function(err, res) {
    let q;
    if (err) { assert.fail(err); }
    assert.ok(validId(res), "job.save() failed in callback result");
    return q = testColl.processJobs(jobType, { pollInterval: 250 }, function(job, cb) {
      assert.equal(job._doc._id, res);
      job.done();
      cb();
      return q.shutdown({ level: 'soft', quiet: true }, () => onComplete());
    });
  });
});

it('Create an invalid job and see that errors correctly propagate', function(onComplete) {
  console.warn("****************************************************************************************************");
  console.warn("***** The following exception dump is a Normal and Expected part of error handling unit tests: *****");
  console.warn("****************************************************************************************************");
  const jobType = `TestJob_${Math.round(Math.random()*1000000000)}`;
  const job = new Job(testColl, jobType, { some: 'data' });
  delete job.doc.status;
  assert.equal(validJobDoc(job.doc), false);
  if (Meteor.isServer) {
    let eventFlag = false;
    let err = null;
    const ev = testColl.events.once('jobSave', function(msg) {
      eventFlag = true;
      if (!msg.error) { return assert.fail(new Error("Server error event didn't dispatch")); }
    });
    try {
      return job.save();
    } catch (e) {
      return err = e;
    }
    finally {
      assert.ok(eventFlag);
      if (!err) { assert.fail(new Error("Server exception wasn't thrown")); }
      onComplete();
    }
  } else {
    return job.save(function(err, res) {
      if (!err) { assert.fail(new Error("Error did not propagate to Client")); }
      return onComplete();
    });
  }
});

it('Create a job and then make a new doc with its document', function(onComplete) {
  let job;
  const jobType = `TestJob_${Math.round(Math.random()*1000000000)}`;
  const job2 = new Job(testColl, jobType, { some: 'data' });
  if (Meteor.isServer) {
    job = new Job('ServerTest', job2.doc);
  } else {
    job = new Job('ClientTest', job2.doc);
  }
  assert.ok(validJobDoc(job.doc));
  return job.save(function(err, res) {
    let q;
    if (err) { assert.fail(err); }
    assert.ok(validId(res), "job.save() failed in callback result");
    return q = testColl.processJobs(jobType, { pollInterval: 250 }, function(job, cb) {
      assert.equal(job._doc._id, res);
      job.done();
      cb();
      return q.shutdown({ level: 'soft', quiet: true }, () => onComplete());
    });
  });
});

it('A repeating job that returns the _id of the next job', function(onComplete) {
  let counter = 0;
  const jobType = `TestJob_${Math.round(Math.random()*1000000000)}`;
  const job = new Job(testColl, jobType, {some: 'data'}).repeat({ repeats: 1, wait: 250 });
  return job.save(function(err, res) {
    let q;
    if (err) { assert.fail(err); }
    assert.ok(validId(res), "job.save() failed in callback result");
    return q = testColl.processJobs(jobType, { pollInterval: 250 }, function(job, cb) {
      counter++;
      if (counter === 1) {
        assert.equal(job.doc._id, res);
        return job.done("Result1", { repeatId: true }, function(err, res) {
          if (err) { assert.fail(err); }
          assert.ok(res != null);
          assert.notEqual(res, true);
          return testColl.getJob(res, function(err, j) {
            if (err) { assert.fail(err); }
            assert.equal(j._doc._id, res);
            return cb();
          });
        });
      } else {
        assert.notEqual(job.doc._id, res);
        return job.done("Result2", { repeatId: true }, function(err, res) {
          if (err) { assert.fail(err); }
          assert.equal(res, true);
          cb();
          return q.shutdown({ level: 'soft', quiet: true }, () => onComplete());
        });
      }
    });
  });
});

it('Dependent jobs run in the correct order', function(onComplete) {
  const jobType = `TestJob_${Math.round(Math.random()*1000000000)}`;
  const job = new Job(testColl, jobType, { order: 1 });
  const job2 = new Job(testColl, jobType, { order: 2 });
  job.delay(1000); // Ensure that job 1 has the opportunity to run first
  return job.save(function(err, res) {
    if (err) { assert.fail(err); }
    assert.ok(validId(res), "job.save() failed in callback result");
    job2.depends([job]);
    return job2.save(function(err, res) {
      let q;
      if (err) { assert.fail(err); }
      assert.ok(validId(res), "job.save() failed in callback result");
      let count = 0;
      return q = testColl.processJobs(jobType, { pollInterval: 250 }, function(job, cb) {
        count++;
        assert.equal(count, job.data.order);
        job.done();
        cb();
        if (count === 2) {
          return q.shutdown({ level: 'soft', quiet: true }, () => onComplete());
        }
      });
    });
  });
});

if (Meteor.isServer) {
  it('Dry run of dependency check returns status object', function(onComplete) {
    const jobType = `TestJob_${Math.round(Math.random()*1000000000)}`;
    const job = new Job(testColl, jobType, { order: 1 });
    const job2 = new Job(testColl, jobType, { order: 2 });
    const job3 = new Job(testColl, jobType, { order: 3 });
    const job4 = new Job(testColl, jobType, { order: 4 });
    const job5 = new Job(testColl, jobType, { order: 5 });
    job.save();
    job2.save();
    job3.save();
    job4.save();
    job5.depends([job, job2, job3, job4]);
    return job5.save(function(err, res) {
      if (err) { assert.fail(err); }
      assert.ok(validId(res), "job2.save() failed in callback result");
      // This creates an inconsistent state
      testColl.update({ _id: job.doc._id, status: 'ready' }, { $set: { status: 'cancelled' }});
      testColl.update({ _id: job2.doc._id, status: 'ready' }, { $set: { status: 'failed' }});
      testColl.update({ _id: job3.doc._id, status: 'ready' }, { $set: { status: 'completed' }});
      testColl.remove({ _id: job4.doc._id });
      const dryRunRes = testColl._checkDeps(job5.doc);
      assert.equal(dryRunRes.cancelled.length, 1);
      assert.equal(dryRunRes.cancelled[0], job.doc._id);
      assert.equal(dryRunRes.failed.length, 1);
      assert.equal(dryRunRes.failed[0], job2.doc._id);
      assert.equal(dryRunRes.resolved.length, 1);
      assert.equal(dryRunRes.resolved[0], job3.doc._id);
      assert.equal(dryRunRes.removed.length, 1);
      assert.equal(dryRunRes.removed[0], job4.doc._id);
      return onComplete();
    });
  });
}

it('Dependent job saved after completion of antecedent still runs', function(onComplete) {
  const jobType = `TestJob_${Math.round(Math.random()*1000000000)}`;
  const job = new Job(testColl, jobType, { order: 1 });
  const job2 = new Job(testColl, jobType, { order: 2 });
  return job.save(function(err, res) {
    let q;
    if (err) { assert.fail(err); }
    assert.ok(validId(res), "job.save() failed in callback result");
    job2.depends([job]);
    let count = 0;
    return q = testColl.processJobs(jobType, { pollInterval: 250 }, function(j, cb) {
      count++;
      j.done(`Job ${j.data.order} Done`, function(err, res) {
        if (err) { assert.fail(err); }
        assert.ok(res);
        if (j.data.order === 1) {
          return job2.save(function(err, res) {
            if (err) { assert.fail(err); }
            return assert.ok(validId(res), "job2.save() failed in callback result");
          });
        } else {
          return q.shutdown({ level: 'soft', quiet: true }, () => onComplete());
        }
      });
      return cb();
    });
  });
});

it('Dependent job saved after failure of antecedent is cancelled', function(onComplete) {
  const jobType = `TestJob_${Math.round(Math.random()*1000000000)}`;
  const job = new Job(testColl, jobType, { order: 1 });
  const job2 = new Job(testColl, jobType, { order: 2 });
  return job.save(function(err, res) {
    let q;
    if (err) { assert.fail(err); }
    assert.ok(validId(res), "job.save() failed in callback result");
    job2.depends([job]);
    return q = testColl.processJobs(jobType, { pollInterval: 250 }, function(j, cb) {
      j.fail(`Job ${j.data.order} Failed`, function(err, res) {
        if (err) { assert.fail(err); }
        assert.ok(res);
        return job2.save(function(err, res) {
          if (err) { assert.fail(err); }
          assert.isNull(res, "job2.save() failed in callback result");
          return q.shutdown({ level: 'soft', quiet: true }, () => onComplete());
        });
      });
      return cb();
    });
  });
});

it('Dependent job saved after cancelled antecedent is also cancelled', function(onComplete) {
  const jobType = `TestJob_${Math.round(Math.random()*1000000000)}`;
  const job = new Job(testColl, jobType, { order: 1 });
  const job2 = new Job(testColl, jobType, { order: 2 });
  return job.save(function(err, res) {
    if (err) { assert.fail(err); }
    assert.ok(validId(res), "job.save() failed in callback result");
    job2.depends([job]);
    return job.cancel(function(err, res) {
      if (err) { assert.fail(err); }
      assert.ok(res);
      return job2.save(function(err, res) {
        if (err) { assert.fail(err); }
        assert.isNull(res, "job2.save() failed in callback result");
        return onComplete();
      });
    });
  });
});

it('Dependent job saved after removed antecedent is cancelled', function(onComplete) {
  const jobType = `TestJob_${Math.round(Math.random()*1000000000)}`;
  const job = new Job(testColl, jobType, { order: 1 });
  const job2 = new Job(testColl, jobType, { order: 2 });
  return job.save(function(err, res) {
    if (err) { assert.fail(err); }
    assert.ok(validId(res), "job.save() failed in callback result");
    job2.depends([job]);
    return job.cancel(function(err, res) {
      if (err) { assert.fail(err); }
      assert.ok(res);
      return job.remove(function(err, res) {
        if (err) { assert.fail(err); }
        assert.ok(res);
        return job2.save(function(err, res) {
          if (err) { assert.fail(err); }
          assert.isNull(res, "job2.save() failed in callback result");
          return onComplete();
        });
      });
    });
  });
});

it('Cancel succeeds for job without deps, with using option dependents: false', function(onComplete) {
  const jobType = `TestJob_${Math.round(Math.random()*1000000000)}`;
  const job = new Job(testColl, jobType, {});
  return job.save(function(err, res) {
    if (err) { assert.fail(err); }
    assert.ok(validId(res), "job.save() failed in callback result");
    return job.cancel({ dependents: false }, function(err, res) {
       if (err) { assert.fail(err); }
       assert.ok(res);
       return onComplete();
    });
  });
});

it('Dependent job with delayDeps is delayed', function(onComplete) {
  this.timeout(10000);
  const jobType = `TestJob_${Math.round(Math.random()*1000000000)}`;
  const job = new Job(testColl, jobType, { order: 1 });
  const job2 = new Job(testColl, jobType, { order: 2 });
  job.delay(1000); // Ensure that job2 has the opportunity to run first
  return job.save(function(err, res) {
    if (err) { assert.fail(err); }
    assert.ok(validId(res), "job.save() failed in callback result");
    job2.depends([job]);
    return job2.save(function(err, res) {
      let q;
      if (err) { assert.fail(err); }
      assert.ok(validId(res), "job.save() failed in callback result");
      let count = 0;
      return q = testColl.processJobs(jobType, { pollInterval: 250 }, function(job, cb) {
        count++;
        assert.equal(count, job.data.order);
        const timer = new Date();
        job.done(null, { delayDeps: 1500 });
        cb();
        if (count === 2) {
          console.log(`${(new Date()).valueOf()} is greater than`);
          console.log(`${timer.valueOf() + 1500}`);
          assert.ok((new Date()).valueOf() > (timer.valueOf() + 1500));
          return q.shutdown({ level: 'soft', quiet: true }, () => onComplete());
        }
      });
    });
  });
});

it('Job priority is respected', function(onComplete) {
  let counter = 0;
  const jobType = `TestJob_${Math.round(Math.random()*1000000000)}`;
  const jobs = [];
  jobs[0] = new Job(testColl, jobType, {count: 3}).priority('low');
  jobs[1] = new Job(testColl, jobType, {count: 1}).priority('high');
  jobs[2] = new Job(testColl, jobType, {count: 2});

  return jobs[0].save(function(err, res) {
    if (err) { assert.fail(err); }
    assert.ok(validId(res), "jobs[0].save() failed in callback result");
    return jobs[1].save(function(err, res) {
      if (err) { assert.fail(err); }
      assert.ok(validId(res), "jobs[1].save() failed in callback result");
      return jobs[2].save(function(err, res) {
        let q;
        if (err) { assert.fail(err); }
        assert.ok(validId(res), "jobs[2].save() failed in callback result");
        return q = testColl.processJobs(jobType, { pollInterval: 250 }, function(job, cb) {
          counter++;
          assert.equal(job.data.count, counter);
          job.done();
          cb();
          if (counter === 3) {
            return q.shutdown({ level: 'soft', quiet: true }, () => onComplete());
          }
        });
      });
    });
  });
});

it('A forever retrying job can be scheduled and run', function(onComplete) {
  let counter = 0;
  const jobType = `TestJob_${Math.round(Math.random()*1000000000)}`;
  const job = new Job(testColl, jobType, {some: 'data'}).retry({retries: testColl.forever, wait: 0});
  return job.save(function(err, res) {
    let q;
    if (err) { assert.fail(err); }
    assert.ok(validId(res), "job.save() failed in callback result");
    return q = testColl.processJobs(jobType, { pollInterval: 250 }, function(job, cb) {
      counter++;
      assert.equal(job.doc._id, res);
      if (counter < 3) {
        job.fail('Fail test');
        return cb();
      } else {
        job.fail('Fail test', { fatal: true });
        cb();
        return q.shutdown({ level: 'soft', quiet: true }, () => onComplete());
      }
    });
  });
});

it('Retrying job with exponential backoff', function(onComplete) {
  let counter = 0;
  const jobType = `TestJob_${Math.round(Math.random()*1000000000)}`;
  const job = new Job(testColl, jobType, {some: 'data'}).retry({retries: 2, wait: 200, backoff: 'exponential'});
  return job.save(function(err, res) {
    let q;
    if (err) { assert.fail(err); }
    assert.ok(validId(res), "job.save() failed in callback result");
    return q = testColl.processJobs(jobType, { pollInterval: 250 }, function(job, cb) {
      counter++;
      assert.equal(job.doc._id, res);
      if (counter < 3) {
        job.fail('Fail test');
        return cb();
      } else {
        job.fail('Fail test');
        cb();
        return q.shutdown({ level: 'soft', quiet: true }, () => onComplete());
      }
    });
  });
});

it('A forever retrying job with "until"', function(onComplete) {
  this.timeout(10000);
  let counter = 0;
  const jobType = `TestJob_${Math.round(Math.random()*1000000000)}`;
  const job = new Job(testColl, jobType, {some: 'data'}).retry({until: new Date(new Date().valueOf() + 1500), wait: 500});
  return job.save(function(err, res) {
    if (err) { assert.fail(err); }
    assert.ok(validId(res), "job.save() failed in callback result");
    const q = testColl.processJobs(jobType, { pollInterval: 250 }, function(job, cb) {
      counter++;
      assert.equal(job.doc._id, res);
      job.fail('Fail test');
      return cb();
    });
    return Meteor.setTimeout(() =>
      job.refresh(function() {
        assert.equal(job._doc.status, 'failed', "Until didn't cause job to stop retrying");
        return q.shutdown({ level: 'soft', quiet: true }, () => onComplete());
      })
    
    ,
      2500
    );
  });
});

it('Autofail and retry a job', function(onComplete) {
  this.timeout(10000);
  let counter = 0;
  const jobType = `TestJob_${Math.round(Math.random()*1000000000)}`;
  const job = new Job(testColl, jobType, {some: 'data'}).retry({retries: 2, wait: 0});
  return job.save(function(err, res) {
    if (err) { assert.fail(err); }
    assert.ok(validId(res), "job.save() failed in callback result");
    const q = testColl.processJobs(jobType, { pollInterval: 250, workTimeout: 500 }, function(job, cb) {
      counter++;
      assert.equal(job.doc._id, res);
      if (counter === 2) {
        job.done('Success');
      }
      // Will be called without done/fail on first attempt
      return cb();
    });

    return Meteor.setTimeout(() =>
      job.refresh(function() {
        assert.equal(job._doc.status, 'completed', "Job didn't successfully autofail and retry");
        return q.shutdown({ level: 'soft', quiet: true }, () => onComplete());
      })
    
    ,
      2500
    );
  });
});

if (Meteor.isServer) {

  it('Save, cancel, restart, refresh: retries are correct.', function(onComplete) {
    const jobType = `TestJob_${Math.round(Math.random()*1000000000)}`;
    const j = new Job(testColl, jobType, { foo: "bar" });
    j.save();
    j.cancel();
    j.restart({ retries: 0 });
    j.refresh();
    assert.equal(j._doc.repeatRetries, j._doc.retries + j._doc.retried);
    return onComplete();
  });

  it('Add, cancel and remove a large number of jobs', function(onComplete) {
    let count;
    let c = (count = 500);
    const jobType = `TestJob_${Math.round(Math.random()*1000000000)}`;
    return (() => {
      const result = [];
      for (let i = 1, end = count, asc = 1 <= end; asc ? i <= end : i >= end; asc ? i++ : i--) {
        const j = new Job(testColl, jobType, { idx: i });
        result.push(j.save(function(err, res) {
          if (err) { assert.fail(err); }
          if (!validId(res)) { assert.fail("job.save() Invalid _id value returned"); }
          c--;
          if (!c) {
            let ids = testColl.find({ type: jobType, status: 'ready'}).map(d => d._id);
            assert.equal(count, ids.length);
            return testColl.cancelJobs(ids, function(err, res) {
              if (err) { assert.fail(err); }
              if (!res) { assert.fail("cancelJobs Failed"); }
              ids = testColl.find({ type: jobType, status: 'cancelled'}).map(d => d._id);
              assert.equal(count, ids.length);
              return testColl.removeJobs(ids, function(err, res) {
                if (err) { assert.fail(err); }
                if (!res) { assert.fail("removeJobs Failed"); }
                ids = testColl.find({ type: jobType });
                assert.equal(0, ids.count());
                return onComplete();
              });
            });
          }
        }));
      }
      return result;
    })();
  });

  it('A forever repeating job with "schedule" and "until"', function(onComplete) {
    this.timeout(10000);
    let counter = 0;
    const jobType = `TestJob_${Math.round(Math.random()*1000000000)}`;
    const job = new Job(testColl, jobType, {some: 'data'})
      .repeat({
        until: new Date(new Date().valueOf() + 3500),
        schedule: testColl.later.parse.text("every 1 second")})
      .delay(1000);
    return job.save(function(err, res) {
      let ev;
      if (err) { assert.fail(err); }
      assert.ok(validId(res), "job.save() failed in callback result");
      const q = testColl.processJobs(jobType, { pollInterval: 250 }, function(job, cb) {
        counter++;
        if (counter === 1) {
          assert.equal(job.doc._id, res);
        } else {
          assert.notEqual(job.doc._id, res);
        }
        job.done({}, { repeatId: true });
        return cb();
      });
      var listener = function(msg) {
        if (counter === 2) {
          return job.refresh(function() {
            assert.equal(job._doc.status, 'completed');
            return q.shutdown({ level: 'soft', quiet: true }, function() {
              ev.removeListener('jobDone', listener);
              return onComplete();
            });
          });
        }
      };
      return ev = testColl.events.on('jobDone', listener);
    });
  });
}

// it 'Run stopJobs on the job collection', (onComplete) ->
//   testColl.stopJobs { timeout: 1 }, (err, res) ->
//     assert.fail(err) if err
//     assert.equal res, true, "stopJobs failed in callback result"
//     if Meteor.isServer
//       assert.notEqual testColl.stopped, false, "stopJobs didn't stop job collection"
//     onComplete()

it('Run shutdownJobServer on the job collection', onComplete =>
  testColl.shutdownJobServer({ timeout: 1 }, function(err, res) {
    if (err) { assert.fail(err); }
    assert.equal(res, true, "shutdownJobServer failed in callback result");
    if (Meteor.isServer) {
      assert.notEqual(testColl.stopped, false, "shutdownJobServer didn't stop job collection");
    }
    return onComplete();
  })
);

if (Meteor.isClient) {

  it('Run startJobServer on remote job collection', onComplete =>
    remoteServerTestColl.startJobServer(function(err, res) {
      if (err) { assert.fail(err); }
      assert.equal(res, true, "startJobServer failed in callback result");
      return onComplete();
    })
  );

  it('Create a job and see that it is added to a remote server collection and runs', function(onComplete) {
    const jobType = `TestJob_${Math.round(Math.random()*1000000000)}`;
    const job = new Job(remoteServerTestColl, jobType, { some: 'data' });
    assert.ok(validJobDoc(job.doc));
    return job.save(function(err, res) {
      let q;
      if (err) { assert.fail(err); }
      assert.ok(validId(res), "job.save() failed in callback result");
      return q = remoteServerTestColl.processJobs(jobType, { pollInterval: 250 }, function(job, cb) {
        assert.equal(job._doc._id, res);
        job.done();
        cb();
        return q.shutdown({ level: 'soft', quiet: true }, () => onComplete());
      });
    });
  });

  it('Run shutdownJobServer on remote job collection', onComplete =>
    remoteServerTestColl.shutdownJobServer({ timeout: 1 }, function(err, res) {
      if (err) { assert.fail(err); }
      assert.equal(res, true, "shutdownJobServer failed in callback result");
      return onComplete();
    })
  );
}
