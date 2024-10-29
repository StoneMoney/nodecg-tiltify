"use strict";
const fetch = require('node-fetch')
const NRP = require('node-redis-pubsub')
const config = {
  port: 6379,
}

module.exports = function (nodecg) {
  const nrp = new NRP(config);
  const app = nodecg.Router();

  var donationsRep = nodecg.Replicant("donations", "nodecg-starbar", {
    defaultValue: [{ id: "0", name: 'Required Differentiator', comment: 'No Comments', amount: 0, read: true, shown: true }],
  });
  var allDonationsRep = nodecg.Replicant("alldonations", "nodecg-starbar", {
    defaultValue: [],
  });
  var campaignTotalRep = nodecg.Replicant("total","nodecg-starbar", {
    defaultValue: 0,
  });
  var pollsRep = nodecg.Replicant("donationpolls","nodecg-starbar", {
    defaultValue: {},
  });
  // LEGACY REPS - EXIST TO NOT BREAK THINGS BUT ARE NOT USED.
  var scheduleRep = nodecg.Replicant("schedule","nodecg-starbar", {
    defaultValue: [],
  });
  var targetsRep = nodecg.Replicant("targets","nodecg-starbar", {
    defaultValue: [],
  });
  var rewardsRep = nodecg.Replicant("rewards","nodecg-starbar", {
    defaultValue: [],
  });
  var donationMatchesRep = nodecg.Replicant("donationmatches","nodecg-starbar", {
    defaultValue: []
  })
  
  function isEmpty(string) {
    return string === undefined || string === null || string === ""
  }

  if (isEmpty(nodecg.bundleConfig.campaign_slug)) {
    nodecg.log.info(
      "Please set campaign_slug in cfg/nodecg-kinstone.json"
    );
    return;
  }

  function pushUniqueDonation(donation) {
    var found = allDonationsRep.value.find(function (element) {
      return element === donation.id;
    });
    if (found === undefined) {
      donation.shown = false;
      donation.read = false;
      donation.completedAt = donation.processed_at;
      donation.comment = donation.comments;
      if(donation.poll) {
        donation.streamer = donation.poll.query;
        donation.incentive = donation.pollItem.answer;
      } else if (!donation.poll) {
        donation.streamer = "MAIN";
      }
      donation.approval = "pending";
      nodecg.sendMessage("push-donation", donation);
      donationsRep.value.push(donation);
      allDonationsRep.value.push(donation.id)
    }
  }

  function updateTotal(campaign) {
    // Less than check in case webhooks are sent out-of-order. Only update the total if it's higher!
    if (campaignTotalRep.value < campaign.total
    ) {
      campaignTotalRep.value = campaign.total;
    }
  }

  function updatePoll(poll) {
    pollsRep.value = { ...pollsRep.value, [poll.query]: poll }
  }

  nrp.on("campaign." + nodecg.bundleConfig.campaign_slug + ".total", (data) => {
    nodecg.log.info('total proc')
    updateTotal(data.data)
  });

  nrp.on("campaign." + nodecg.bundleConfig.campaign_slug + ".donations", (data) => {
    nodecg.log.info('donations proc')
    pushUniqueDonation(data.data)
  });

  nrp.on("campaign." + nodecg.bundleConfig.campaign_slug + ".poll", (data) => {
    nodecg.log.info('poll proc')
    updatePoll(data.data)
  });

  nodecg.listenFor("clear-donations", "nodecg-starbar", (value, ack) => {
    donationsRep.value = [{ id: "0", name: 'Required Differentiator', comment: 'No Comments', amount: 0, read: true, shown: true }];

    if (ack && !ack.handled) {
      ack(null, value);
    }
  });

  nodecg.listenFor("mark-donation-as-read", "nodecg-starbar", (value, ack) => {
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

  nodecg.listenFor("mark-donation-as-shown", "nodecg-starbar", (value, ack) => {
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

  donationsRep.value = donationsRep.value.filter((t)=>(!isNaN(t.amount)))
  nodecg.mount(app);

};
