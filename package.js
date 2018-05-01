/***************************************************************************
###     Copyright (C) 2014-2017 by Vaughn Iverson
###     job-collection is free software released under the MIT/X11 license.
###     See included LICENSE file for details.
***************************************************************************/

var currentVersion = '1.5.2';

Package.describe({
  summary: "A persistent and reactive job queue for Meteor, supporting distributed workers that can run anywhere",
  name: 'simonsimcity:job-collection',
  version: currentVersion,
  git: 'https://github.com/simonsimcity/meteor-job-collection.git'
});

Package.onUse(function(api) {
  api.use('coffeescript@2.0.3_3', ['server','client']);
  api.use('ecmascript@0.9.0', ['server','client']);
  api.use('mongo@1.1.18', ['server','client']);
  api.use('check@1.2.5', ['server','client']);
  api.addFiles('job/src/job_class.coffee', ['server','client']);
  api.addFiles('src/shared.coffee', ['server','client']);
  api.addFiles('src/server.coffee', 'server');
  api.addFiles('src/client.coffee', 'client');
  api.export('Job');
  api.export('JobCollection');

  Npm.depends({
    later: '1.2.0',
  });
});

Package.onTest(function (api) {
  api.use('simonsimcity:job-collection@' + currentVersion, ['server','client']);
  api.use('coffeescript@2.0.3_3', ['server','client']);
  api.use('ecmascript@0.9.0', ['server','client']);
  api.use('check@1.2.5', ['server','client']);
  api.use('meteortesting:mocha@1.0.0', ['server','client']);
  api.use('ddp@1.2.5', 'client');

  Npm.depends({
    later: '1.2.0',
    chai: '4.1.2',
  });

  api.addFiles('test/job_collection.test.coffee', ['server', 'client']);
});
