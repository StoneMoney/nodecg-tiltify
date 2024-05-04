"use strict";
const fetch = require('node-fetch')
let crypto;
let WEBHOOK_MODE = true

try {
  crypto = require('node:crypto');
} catch (err) {
  nodecg.log.error('ERROR: crypto support is disabled! webhook message authenticity cannot be validated. try a newer node version.');
  WEBHOOK_MODE = false;
}

module.exports = function (nodecg) {
  const app = nodecg.Router();

  var donationsRep = nodecg.Replicant("donations", {
    defaultValue: [{ id: "0", name: 'Required Differentiator', comment: 'No Comments', amount: 0, read: true, shown: true }],
  });
  var allDonationsRep = nodecg.Replicant("alldonations", {
    defaultValue: [],
  });
  var campaignTotalRep = nodecg.Replicant("total", {
    defaultValue: 0,
  });
  var pollsRep = nodecg.Replicant("donationpolls", {
    defaultValue: [],
  });
  var scheduleRep = nodecg.Replicant("schedule", {
    defaultValue: [],
  });
  var targetsRep = nodecg.Replicant("targets", {
    defaultValue: [],
  });
  var rewardsRep = nodecg.Replicant("rewards", {
    defaultValue: [],
  });
  var donationMatchesRep = nodecg.Replicant("donationmatches", {
    defaultValue: []
  })

  var TiltifyClient = require("tiltify-api-client");
  
  function isEmpty(string) {
    return string === undefined || string === null || string === ""
  }

  if (isEmpty(nodecg.bundleConfig.tiltify_webhook_secret) || isEmpty(nodecg.bundleConfig.tiltify_webhook_id)) {
    WEBHOOK_MODE = false
    nodecg.log.info("Running without webhooks!! Please set webhook secret, and webhook id in cfg/nodecg-tiltify.json [See README]");
    return;
  }

  if (isEmpty(nodecg.bundleConfig.tiltify_client_id)) {
    nodecg.log.info("Please set tiltify_client_id in cfg/nodecg-tiltify.json");
    return;
  }

  if (isEmpty(nodecg.bundleConfig.tiltify_client_secret)) {
    nodecg.log.info("Please set tiltify_client_secret in cfg/nodecg-tiltify.json");
    return;
  }

  if (isEmpty(nodecg.bundleConfig.tiltify_campaign_id)) {
    nodecg.log.info(
      "Please set tiltify_campaign_id in cfg/nodecg-tiltify.json"
    );
    return;
  }

  var client = new TiltifyClient(nodecg.bundleConfig.tiltify_client_id, nodecg.bundleConfig.tiltify_client_secret);

  function pushUniqueDonation(donation) {
    var found = allDonationsRep.value.find(function (element) {
      return element === donation.id;
    });
    if (found === undefined) {
      donation.shown = false;
      donation.read = false;
      donation.amount = parseFloat(donation.amount.value);
      donation.name = donation.donor_name;
      donation.completedAt = donation.completed_at;
      donation.isMatch = donation.is_match;
      donation.matchingRate = donation.donation_matches?.length ?? 0;
      if(donationMatchesRep.value.filter((t)=>t.active).length > 0 || (donation.donation_matches?.length ?? 0) > 0) {
        askTiltifyForDonationMatches()
      }
      nodecg.sendMessage("push-donation", donation);
      donationsRep.value.push(donation);
      allDonationsRep.value.push(donation.id)
    }
  }

  // function updateMatchingDonations(donation) {
  //   if(donation.donation_matches && donation.donation_matches.length > 0) {
  //     let matches = donationMatchesRep.value
  //     for (let donationMatch of donation.donation_matches) {
  //       let index = matches.findIndex((item) => ((item.id == donationMatch.id && (new Date(donation.created_at).getTime() > new Date(item.updated_at).getTime()))))
  //       if(index >= 0) {
  //         donationMatch.updated_at = donation.created_at
  //         matches[index] = donationMatch
  //       }
  //     }
  //     donationMatchesRep.value = matches
  //   }
  // }

  function updateTotal(campaign) {
    // Less than check in case webhooks are sent out-of-order. Only update the total if it's higher!
    if (campaignTotalRep.value < parseFloat(campaign.amount_raised.value)
    ) {
      campaignTotalRep.value = parseFloat(campaign.amount_raised.value);
    }
  }

  /**
   * Verifies that the payload delivered matches the signature provided, using sha256 algorithm and the webhook secret
   * Acts as middleware, use in route chain
   */
  function validateSignature(req, res, next) {
    const signatureIn = req.get('X-Tiltify-Signature')
    const timestamp = req.get('X-Tiltify-Timestamp')
    const signedPayload = `${timestamp}.${JSON.stringify(req.body)}`
    const hmac = crypto.createHmac('sha256', nodecg.bundleConfig.tiltify_webhook_secret);
    hmac.update(signedPayload);
    const signature = hmac.digest('base64');
    if (signatureIn === signature) {
      next()
    } else {
      // Close connection (200 code MUST be sent regardless)
      res.sendStatus(200)
    };
  }

  app.post('/nodecg-tiltify/webhook', validateSignature, (req, res) => {
    // Verify this webhook is sending out stuff for the campaign we're working on
    if (
      req.body.meta.event_type === "public:direct:donation_updated" &&
      req.body.data.campaign_id === nodecg.bundleConfig.tiltify_campaign_id
    ) {
      // New donation
      pushUniqueDonation(req.body.data)
    } else if (
      req.body.meta.event_type === "public:direct:fact_updated" &&
      req.body.data.id === nodecg.bundleConfig.tiltify_campaign_id
    ) {
      // Updated amount raised
      updateTotal(req.body.data)
    }
    // Send ack
    res.sendStatus(200)
  })

  async function askTiltifyForDonations() {
    client.Campaigns.getRecentDonations(
      nodecg.bundleConfig.tiltify_campaign_id,
      function (donations) {
        for (let i = 0; i < donations.length; i++) {
          pushUniqueDonation(donations[i])
        }
      }
    );
  }

  async function askTiltifyForAllDonations() {
    client.Campaigns.getDonations(
      nodecg.bundleConfig.tiltify_campaign_id,
      function (alldonations) {
        allDonationsRep.value = alldonations.map((donation) => donation.id)
      }
    );
  }

  async function askTiltifyForPolls() {
    client.Campaigns.getPolls(
      nodecg.bundleConfig.tiltify_campaign_id,
      function (polls) {
        if (JSON.stringify(pollsRep.value) !== JSON.stringify(polls)) {
          pollsRep.value = polls;
        }
      }
    );
  }

  async function askTiltifyForSchedule() {
    client.Campaigns.getSchedule(
      nodecg.bundleConfig.tiltify_campaign_id,
      function (schedule) {
        if (JSON.stringify(scheduleRep.value) !== JSON.stringify(schedule)) {
          scheduleRep.value = schedule;
        }
      }
    );
  }

  async function askTiltifyForTargets() {
    client.Campaigns.getTargets(
      nodecg.bundleConfig.tiltify_campaign_id,
      function (targets) {
        if (
          JSON.stringify(targetsRep.value) !== JSON.stringify(targets)
        ) {
          targetsRep.value = targets;
        }
      }
    );
  }

  async function askTiltifyForRewards() {
    client.Campaigns.getRewards(
      nodecg.bundleConfig.tiltify_campaign_id,
      function (rewards) {
        if (JSON.stringify(rewardsRep.value) !== JSON.stringify(rewards)) {
          rewardsRep.value = rewards;
        }
      }
    );
  }

  async function askTiltifyForTotal() {
    client.Campaigns.get(nodecg.bundleConfig.tiltify_campaign_id, function (
      campaign
    ) {
      updateTotal(campaign)
    });
  }

  async function askTiltifyForDonationMatches() {
    client.Campaigns.getDonationMatches(nodecg.bundleConfig.tiltify_campaign_id, function (
      matches
    ) {
      donationMatchesRep.value = matches
    })
  }

  function askTiltify() {
    // Donations and total are handled by websocket normally, only ask if not using websockets
    if (!WEBHOOK_MODE) {
      askTiltifyForDonations();
      askTiltifyForTotal();
    }
    askTiltifyForPolls();
    askTiltifyForTargets();
    askTiltifyForSchedule();
    askTiltifyForRewards();
    askTiltifyForDonationMatches();
  }

  client.initialize().then(()=>{
    if (WEBHOOK_MODE) {
      client.Webhook.activate(nodecg.bundleConfig.tiltify_webhook_id, () => {
        nodecg.log.info('Webhooks staged!')
      })
      const events = {"event_types": ["public:direct:fact_updated", "public:direct:donation_updated"]}
      client.Webhook.subscribe(nodecg.bundleConfig.tiltify_webhook_id, nodecg.bundleConfig.tiltify_campaign_id, events, () => {
        nodecg.log.info('Webhooks activated!')
      })
    }

    askTiltifyForTotal();
    askTiltify();
    askTiltifyForAllDonations();

    setInterval(function () {
      askTiltifyForTotal();
      askTiltify();
    }, WEBHOOK_MODE ? 120000 : 5000); // 2 MINUTES OR 5 SECONDS
  
    setInterval(function () {
      askTiltifyForAllDonations();
    }, 15 * 60000); // 15 MINUTES
  })

  nodecg.listenFor("clear-donations", (value, ack) => {
    donationsRep.value = [{ id: "0", name: 'Required Differentiator', comment: 'No Comments', amount: 0, read: true, shown: true }];

    if (ack && !ack.handled) {
      ack(null, value);
    }
  });

  nodecg.listenFor("mark-donation-as-read", (value, ack) => {
    nodecg.log.info("Mark read", value.id)
    var isElement = (element) => element.id === value.id;
    var elementIndex = donationsRep.value.findIndex(isElement);
    if (elementIndex !== -1) {
      nodecg.log.info("Found", elementIndex, donationsRep.value[elementIndex])
      // const workingArray = donationsRep.value
      // workingArray.splice(elementIndex, 1)
      // donationsRep.value = workingArray
      if(donationsRep.value[elementIndex].shown) {
        donationsRep.value.splice(elementIndex, 1)
      } else {
        donationsRep.value[elementIndex].read = true;
      }
      if (ack && !ack.handled) {
        ack(null, null);
      }
    } else {
      if (ack && !ack.handled) {
        nodecg.log.error('Donation not found to mark as read | id:', value.id);
        ack(new Error("Donation not found to mark as read"), null);
      }
    }
  });

  nodecg.listenFor("mark-donation-as-shown", (value, ack) => {
    var isElement = (element) => element.id === value.id;
    var elementIndex = donationsRep.value.findIndex(isElement);
    if (elementIndex !== -1) {
      if(donationsRep.value[elementIndex].read) {
        donationsRep.value.splice(elementIndex, 1)
      } else {
        donationsRep.value[elementIndex].shown = true;
      }
      if (ack && !ack.handled) {
        ack(null, null);
      }
    } else {
      if (ack && !ack.handled) {
        nodecg.log.error('Donation not found to mark as shown | id:', value.id);
        ack(new Error("Donation not found to mark as shown"), null);
      }
    }
  });

  nodecg.mount(app);

};
