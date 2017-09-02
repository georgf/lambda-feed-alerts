const eyes = require('eyes');
const xml2js = require('xml2js');
const http = require('http');
const fs = require('fs');
const async = require('asyncawait/async');
const await = require('asyncawait/await');
const aws = require('aws-sdk');

const isAwsLambda = (process.env.RUNNING_ON_LAMBDA === "1");

let config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
if (!isAwsLambda) {
  aws.config.update(config, true);
}

const s3 = new aws.S3({apiVersion: '2006-03-01'});
const ses = new aws.SES({apiVersion: '2010-12-01'});
const testWithLocalFiles = false;

function loadFeed(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      // Error handling.
      const { statusCode } = res;
      let error;

      if (statusCode !== 200) {
        error = new Error('Request Failed.\n' +
                          `Status Code: ${statusCode}`);
      }

      if (error) {
        console.error("loadFeed", error.message);
        // Consume response data to free up memory.
        res.resume();
        reject(res);
        return;
      }

      resolve(res);
    });
  });
}

function parseXmlFromRes(res) {
  return new Promise((resolve, reject) => {
    // Parse XML data from response.
    let responseData = '';
    let parser = new xml2js.Parser();

    res.setEncoding('utf8');

    res.on('error', err => {
      console.error('parseXmlFromRes', err.message);
      reject(err);
    });
    res.on('data', chunk => responseData += chunk);
    res.on('end', () => {
      parser.parseString(responseData, (err, result) => {
        if (err) {
          console.error('parseXmlFromRes 2', err.message);
          reject(err);
          return;
        }

        resolve(result);
      });
    });
  });
}

let loadSeenItems = async(function() {
  let items;
  if (!isAwsLambda && testWithLocalFiles) {
    items = JSON.parse(fs.readFileSync('seen.json', 'utf8'));
  } else {
    items = await(new Promise((resolve, reject) => {
      let params = {
        Bucket: config.seenS3Bucket,
        Key: config.seenS3Key
      };
      s3.getObject(params, (err, data) => {
        if (err) {
          console.error("loadSeenItems", err, err.stack);
          reject(err);
          return;
        }

        console.log("loaded seen.json from s3 with contenttype", data.ContentType);
        let result = JSON.parse(data.Body.toString());
        eyes.inspect(result);
        resolve(result);
      });
    }));
    console.log("items:");
    eyes.inspect(items);
  }


  // Filter items that are older than 1 week to avoid unbounded storage growth.
  const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;
  let now = new Date();
  return items.filter(it => (now - new Date(it.firstSeen)) <= ONE_WEEK);
});

function saveSeenItems(seen, unseen) {
  let now = new Date();
  let save = unseen.map(it => { return {id: it.id, firstSeen: now} })
                   .concat(seen);
  if (!isAwsLambda && testWithLocalFiles) {
    fs.writeFileSync('seen.json', JSON.stringify(save, null, 2), 'utf8');
    return;
  }

  return new Promise((reject, resolve) => {
    let params = {
      Bucket: config.seenS3Bucket,
      Key: config.seenS3Key,
      ContentType: "application/json",
      Body: JSON.stringify(save, null, 2)
    };

    s3.putObject(params, (err, data) => {
      if (err) {
        console.error("saveSeenItems", err, err.stack);
        reject(err);
        return;
      }

      console.log("success saving seen items");
      resolve([]);
    });
  });
}

function buildEmailBody(unseen) {
  return unseen.map(u =>
    `<h1><a href="${u.link}">${u.title}</a></h1>` +
    `<i>published: ${u.pubDate}</i><br>` +
    u.description
  ).join('<br>');
}

function sendEmail(content) {
  return new Promise((resolve, reject) => {
    ses.sendEmail({
      Source: config.fromEmail,
      Destination: {
        ToAddresses: config.toEmails
      },
      Message: {
        Subject: {
          Data: 'Kofferalarm'
        },
        Body: {
          Html: {
            Data: content,
          }
        }
      }
    }, function(err, data) {
      if (err) {
        console.error('Error sending email', err);
        reject(err);
        return;
      }

      console.log('Email sent:');
      console.log(data);
      resolve();
    });
  });
}

/***********************
 * main.
 **********************/

let main = async(function() {
  let url = config.adsFeedUrl + "&_t=" + (new Date()).getTime();
  let res = await(loadFeed(url));
  let data = await(parseXmlFromRes(res));

  let items = data.rss.channel[0].item;
  for (item of items) {
    item.id = item.link[0].split('/').pop();
  }
  console.log(`Got ${items.length} results:`);
  eyes.inspect(items);

  let seen = await(loadSeenItems());
  let seenSet = new Set(seen.map(s => s.id));
  let unseen = items.filter(item => !seenSet.has(item.id));

  console.log(`Previously seen ${seen.length} elements:`);
  eyes.inspect(seen);
  console.log(`Have ${unseen.length} unseen elements:`);
  eyes.inspect(unseen);

  if (unseen.length > 0) {
    let content = buildEmailBody(unseen);
    await(sendEmail(content));
  }

  await(saveSeenItems(seen, unseen));
});

exports.handler = function(event, context, callback) {
  console.log("Kofferklein");
  console.log("Event:\n:" + JSON.stringify(event, null, 2));

  main().then(() => context.succeed())
  .catch(err => {
    console.error("exports.handler", err);
    context.done(null, "Oops... " + err)
  });
}
