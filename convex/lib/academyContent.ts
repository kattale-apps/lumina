/**
 * Built-in text of the Solar Switch Sales Academy.
 *
 * This is the starting course: four modules, each with lessons and a quiz. A
 * company's administrator can rewrite any module; an edited module is stored
 * in `academyModules` and replaces the text here for that company.
 *
 * Lesson bodies are plain text. A line starting with "## " is a sub-heading,
 * lines starting with "- " are a bulleted list, and a blank line starts a new
 * paragraph.
 */
import type { ModuleContent } from "./academy";

export const ACADEMY_NAME = "Solar Switch Sales Academy";

export const DEFAULT_MODULES: ModuleContent[] = [
  {
    key: "m1",
    title: "Solar and power basics",
    summary:
      "The units, the parts of a solar system and the system types, so you can explain solar correctly and spot what a customer needs.",
    passPercent: 80,
    lessons: [
      {
        key: "m1-l1",
        title: "Power, energy and the Yaka unit",
        body: `Customers talk about "units" and what they spend on Yaka. To help them you need two ideas and you must never mix them up.

## Power is how hard something pulls
Power is measured in watts (W). A 10 W bulb pulls little; a 2,000 W kettle pulls a lot. 1,000 W is 1 kilowatt (kW). Power decides how big the inverter must be, because the inverter has to supply everything that is switched on at the same moment.

## Energy is power used over time
Energy is measured in watt-hours (Wh) or kilowatt-hours (kWh). One Yaka unit is one kWh.

Energy = power x hours. A 100 W television on for 10 hours uses 1,000 Wh, which is 1 kWh, which is 1 unit. Energy decides how many panels and how much battery a customer needs.

## Two more things to listen for
- Peak load: the most that runs at once. A home can use little energy in a day but still have a high peak when the iron, kettle and pump run together.
- Starting surge: fridges, freezers, pumps and other motors pull several times their running power for a moment when they start. The inverter must survive that.

When a customer says "I buy 150 units a month", that is about 5 kWh a day. That one number already tells you roughly what size of system to talk about.`
      },
      {
        key: "m1-l2",
        title: "The parts of a solar system",
        body: `Every system you sell is built from the same few parts. Know what each one does and which number on its label matters.

## Solar panels
They make electricity from sunlight. The label gives watts-peak (Wp), the output in ideal sun. Real output is lower, which is why sizing uses conservative sun hours. Panels are wired in series into "strings", and the string voltage must suit the inverter or charge controller.

## Inverter
It turns battery and solar power (DC) into the power appliances use (AC). The label gives continuous power in watts and often a higher surge figure. Many inverters are marked in kVA; the watt figure is the one to compare with the customer's load.

## Batteries
They store energy for night and outages. The label gives voltage (V) and capacity in amp-hours (Ah). Energy = V x Ah, so a 48 V 100 Ah battery holds about 4,800 Wh. Not all of it should be used: how deep a battery may be discharged depends on its chemistry and the manufacturer's figure.

## Charge controller
It controls how the panels charge the batteries. MPPT controllers get more from the panels than PWM controllers. Many hybrid inverters have the controller built in.

## Everything else
Mounting, cables, breakers, fuses, surge protection and earthing. They are not exciting, but a system without them is neither safe nor complete. Never leave them out to make a price look lower.`
      },
      {
        key: "m1-l3",
        title: "System types and who they suit",
        body: `Solar Switch works with four system types. Choosing the right one starts with one question: how reliable is the customer's grid power?

## Grid-tied
Panels and an inverter with no battery. It cuts the bill during the day. It gives no power during an outage, and you must say so plainly. It suits customers with reliable grid power and high daytime use.

## Hybrid
Panels, batteries and a connection to the grid. Solar runs the loads and charges the batteries; the grid is the fallback. It suits homes and businesses where the grid often goes off and the customer wants both savings and backup.

## Off-grid
Panels and batteries with no grid at all. The system must carry everything, including cloudy days, so batteries are sized in days of autonomy. It suits sites with no grid connection.

## Backup only
An inverter and batteries charged from the grid, with no panels. It keeps important loads running through outages but does not reduce the bill. Panels can often be added later.

## Critical loads
With hybrid and backup systems, ask which appliances must stay on during an outage: lights, fridge, router, a till, medical equipment. Backing up only those keeps the battery, and the price, sensible.`
      },
      {
        key: "m1-l4",
        title: "What solar can and cannot promise",
        body: `Customers trust the agent who tells the truth. These are the limits you explain every time.

- The sun varies. Systems are sized on a conservative number of sun hours so that they still work in a poor month, but a run of dark, rainy days will reduce what any system produces.
- Batteries are finite. Backup hours depend on what is switched on. If the customer adds a heater or an iron to a system sized for lights and a fridge, the backup time falls.
- Shade matters. A tree or water tank that shades part of an array can cut output heavily. Note it for the technician.
- Parts wear. Batteries have a limited number of cycles and their capacity fades over the years. Panels lose a little output each year. Quote the warranty that is on the product, not one you remember.
- Savings depend on use. What a customer saves depends on how much they use in the day, the tariff, and how they behave after installation.

## The rule in Solar Switch
The app's sizing is a calculation, not a certified design. Until a technician has reviewed a design, everything you show is illustrative. Say "this is an estimate that our technician will confirm", and never "this is guaranteed".`
      }
    ],
    questions: [
      {
        key: "m1-q1",
        prompt: "A customer runs a 200 W freezer load for 10 hours. How much energy is that?",
        options: ["2 kWh, which is 2 units", "200 kWh", "20 units", "2,000 units"],
        correctIndex: 0,
        explanation: "200 W x 10 h = 2,000 Wh = 2 kWh, and one unit is one kWh."
      },
      {
        key: "m1-q2",
        prompt: "Which figure mainly decides how big the inverter must be?",
        options: [
          "The total units used in a month",
          "The most power that runs at the same moment, including motor start-up",
          "The number of rooms in the house",
          "The size of the roof"
        ],
        correctIndex: 1,
        explanation: "The inverter must supply the peak load and survive starting surges. Energy decides panels and batteries."
      },
      {
        key: "m1-q3",
        prompt: "Roughly how much energy does a 48 V, 100 Ah battery hold?",
        options: ["480 Wh", "4,800 Wh", "148 Wh", "48,000 Wh"],
        correctIndex: 1,
        explanation: "Energy = voltage x amp-hours: 48 x 100 = 4,800 Wh. Only part of it should be used."
      },
      {
        key: "m1-q4",
        prompt: "A customer has reliable grid power and wants to cut a high daytime bill. They choose grid-tied with no battery. What must you tell them?",
        options: [
          "It will keep the lights on during outages",
          "It gives no power during an outage",
          "It needs no technician review",
          "It works best at night"
        ],
        correctIndex: 1,
        explanation: "A grid-tied system without a battery switches off when the grid is off."
      },
      {
        key: "m1-q5",
        prompt: "The grid at a clinic goes off most days and they want savings and backup. Which system type is the natural starting point?",
        options: ["Grid-tied", "Backup only", "Hybrid", "No system"],
        correctIndex: 2,
        explanation: "Hybrid gives solar savings and battery backup, with the grid as a fallback."
      },
      {
        key: "m1-q6",
        prompt: "How should you describe a sizing result that a technician has not yet reviewed?",
        options: [
          "As a guaranteed design",
          "As an estimate that a technician will confirm",
          "As the final official quotation",
          "You should not show it to the customer at all"
        ],
        correctIndex: 1,
        explanation: "Everything is illustrative until a technician has verified the design."
      }
    ]
  },
  {
    key: "m2",
    title: "Finding and qualifying leads",
    summary:
      "Who gains most from solar, where to find them, and how to tell in a few questions whether a lead is worth an assessment.",
    passPercent: 80,
    lessons: [
      {
        key: "m2-l1",
        title: "Who benefits most",
        body: `Not everyone needs the same thing, and some people do not need solar yet. Look for a real problem that solar solves.

## Strong prospects
- People who spend a lot on electricity every month and use much of it in the daytime.
- Homes and businesses where the grid goes off often: outages cost them stock, customers or comfort.
- Sites with no grid connection, or where connecting would cost more than a solar system.
- Businesses with steady daytime loads: salons, clinics, pharmacies, schools, offices, shops with fridges and freezers, farms with pumps or milling.
- People who already have solar that no longer covers their needs. They are easy to talk to because they already believe in it.

## Weaker prospects
- Very low use and reliable grid power. A small backup may still help, but be honest about the savings.
- People who want solar to run heavy heating all night on a small budget. Explain what that would take before going further.
- Tenants with no permission from the landlord. Solve the permission first.

A good lead identifier does not push solar at everyone. You look for the person whose problem is expensive, and you bring them a solution that fits.`
      },
      {
        key: "m2-l2",
        title: "Where leads come from",
        body: `Most sales start with a conversation you were already having.

## Your own network
Family, neighbours, your savings group, your place of worship, your old school, traders you buy from. Tell them what you do and ask one question: "What does power cost you, and does it go off?"

## Referrals
A satisfied customer is your best source. After every installation, ask who else they know with the same problem, and ask permission to mention their name.

## Places where the problem is visible
- A shop running a generator.
- A street that goes dark during load-shedding.
- A salon or clinic that sends customers away when power fails.
- New buildings and estates under construction.
- Farms and schools away from the grid.

## The public power check
Solar Switch has a public page where anyone can work out what power they use and see solar options without prices, and a second check for people who already have solar. Share the link. A person who completes it and asks for a quote arrives in the app as a quote request with their numbers already filled in.

## Follow up
Most people do not decide the first time. Agree when you will speak again, write it down, and keep your word. Reliable follow-up wins more sales than a clever pitch.`
      },
      {
        key: "m2-l3",
        title: "Qualifying a lead in five questions",
        body: `Before you spend an hour on an assessment, find out whether this lead is real. Five questions are enough.

## 1. What do you want to power?
Listen for the appliances and for the problem behind them. "My fridge stock spoils" is a stronger reason than "I am curious".

## 2. What is your grid power like?
Reliable, often off, or not connected. This points to grid-tied, hybrid, backup or off-grid.

## 3. What do you use or spend now?
Units per month, Yaka spending, or generator fuel. If they do not know, the power check works it out from their appliances or their token messages.

## 4. Where is the property, and who decides?
You need the location for a site visit. You also need to know whether you are talking to the person who decides and pays, or whether a spouse, landlord, board or head office must agree.

## 5. When, and how would you pay?
Now, in a few months, or just exploring. Cash, or instalments. Do not guess a budget for them and do not promise financing that has not been approved.

## Then decide
- Ready: book the assessment.
- Not yet: agree a date to follow up.
- Not a fit: say so kindly. They will remember that you were honest.`
      },
      {
        key: "m2-l4",
        title: "Recording a lead and respecting the customer",
        body: `A lead that is not recorded is lost. A lead recorded carelessly wastes the technician's time.

## Record it the same day
Add the customer, their phone number and the site while the conversation is fresh. Write the facts you heard, not your hopes: what they run, what they spend, what they asked for. Spell names and phone numbers correctly; a wrong digit loses the sale.

## Ask before you collect
- Say why you want their phone number and that the company will contact them about their enquiry.
- Save a GPS location only with the customer's consent. The app asks you to confirm this.
- Take photos of equipment or nameplates only with permission.

## Protect what you collect
Customer names, phone numbers, locations and what they own are personal data. Uganda's Data Protection and Privacy Act, 2019 requires that such data is collected for a clear purpose and kept safe. In practice:
- Keep customer details in the app, not in personal notebooks or public chat groups.
- Do not share one customer's details with another customer, or with anyone outside the company.
- Do not use customer contacts for anything except the company's business with them.

## Keep your promise
If you said "we will call you by Friday", make sure someone does. Trust is the thing you are really selling.`
      }
    ],
    questions: [
      {
        key: "m2-q1",
        prompt: "Which of these is the strongest prospect?",
        options: [
          "A home with reliable power that uses very little electricity",
          "A pharmacy that loses fridge stock whenever the grid goes off",
          "A tenant whose landlord has refused any installation",
          "Someone who is only curious and will not share a phone number"
        ],
        correctIndex: 1,
        explanation: "The pharmacy has an expensive, repeated problem that solar with backup solves."
      },
      {
        key: "m2-q2",
        prompt: "What is usually your best source of new leads?",
        options: ["Random phone calls", "Referrals from satisfied customers", "Buying phone lists", "Waiting at the office"],
        correctIndex: 1,
        explanation: "A happy customer's recommendation brings people with the same problem and existing trust."
      },
      {
        key: "m2-q3",
        prompt: "Why do you ask \"who decides?\" when qualifying a lead?",
        options: [
          "To avoid visiting the site",
          "Because the person you are speaking to may not be the one who agrees and pays",
          "To increase the price",
          "Because the app requires it before sizing"
        ],
        correctIndex: 1,
        explanation: "If a spouse, landlord or board must agree, you need them in the conversation before a quotation."
      },
      {
        key: "m2-q4",
        prompt: "A customer does not know how many units they use. What is the best next step?",
        options: [
          "Guess a number so the quote looks affordable",
          "Tell them solar is not for them",
          "Work it out with the power check from their appliances or token messages",
          "Skip the question"
        ],
        correctIndex: 2,
        explanation: "The power check estimates daily use from an appliance list or from token messages."
      },
      {
        key: "m2-q5",
        prompt: "When may you save a customer's GPS location?",
        options: [
          "Always, it helps the technician",
          "Only with the customer's consent",
          "Only for business customers",
          "Never"
        ],
        correctIndex: 1,
        explanation: "GPS is personal data and is saved only with consent; the app asks you to confirm it."
      },
      {
        key: "m2-q6",
        prompt: "A friend who sells generators asks for the phone numbers of your recent leads. What do you do?",
        options: [
          "Share them, since he is a friend",
          "Share only the business customers",
          "Refuse: customer details are used only for the company's business with that customer",
          "Sell them"
        ],
        correctIndex: 2,
        explanation: "Customer contacts are personal data collected for one purpose and must not be passed on."
      }
    ]
  },
  {
    key: "m3",
    title: "Assessing needs with Solar Switch",
    summary:
      "How to run a site conversation, build an assessment, check an existing system and reach an illustrative quotation in the app.",
    passPercent: 80,
    lessons: [
      {
        key: "m3-l1",
        title: "The site conversation",
        body: `A good assessment is a careful conversation. The system can only be as right as the list you bring back.

## Walk the property
Go room by room with the customer and list what uses power. People forget the water pump, the security lights, the second fridge and the phone chargers until they see them.

## For each appliance, capture four things
- How many there are.
- Its power in watts. Read the nameplate where you can. A figure from the label is better than a typical figure, and the app records which one you used.
- How many hours a day it runs, and at what time of day. Daytime use can come straight from the panels; night use must come from the battery.
- Whether it is critical, meaning it must stay on during an outage.

## Notice the motors
Fridges, freezers, pumps, compressors and mills surge when they start. Enter the surge where the label gives it, or tell the technician what the motor is.

## Look around
- Where could panels go? Which way does the roof face, and what shades it?
- Where would the inverter and batteries sit: dry, ventilated, secure?
- Is there an existing system, a generator, or a changeover switch?

Write down what you see. Hours and watts given by the customer are estimates; say so in your notes so the technician knows what still needs checking.`
      },
      {
        key: "m3-l2",
        title: "Building the assessment and sizing",
        body: `In Solar Switch the order is always the same: customer, site, assessment, sizing.

## The assessment
Open the customer, choose the site and start an assessment. Add each appliance with its quantity, power, hours and schedule, and mark the critical ones. Choose the system type. A hybrid or backup system needs the backup hours wanted; an off-grid system needs the days of autonomy. Complete the assessment when the list is right.

You can do this with no signal. Work saved offline stays a draft on your phone until it has synchronised.

## Sizing
Sizing takes the completed assessment and the company's catalogue and proposes configurations: an inverter, panels and batteries that fit together. Each configuration lists its checks:
- Pass: the product's specifications meet the requirement.
- Fail: it does not fit. The configuration is not offered.
- Needs review: something could not be confirmed, often because a specification is missing or a judgement is needed. Only a technician can resolve these.

"Cannot validate" never means "probably fine". It means a technician must look.

## If nothing fits
Sizing tells you why: no product large enough, a voltage that does not match, or missing specifications. Do not work around it by choosing products yourself. Pass the reason to the technician or the inventory administrator.`
      },
      {
        key: "m3-l3",
        title: "Customers who already have solar",
        body: `Many customers already own a system and want more: longer backup, more panels, a bigger inverter. The upgrade check in Solar Switch works out what fits the equipment they have.

## Read the labels
Type in what is on the nameplates, not what the customer remembers:
- System voltage, meaning the battery bank voltage: usually 12, 24 or 48 V.
- Inverter: its power in watts, and whether the panels plug straight into it.
- Charge controller, if there is a separate one: MPPT or PWM, its amps and its maximum solar voltage.
- Panels: how many, their watts, and how many are wired in each string.
- Batteries: how many, their voltage and Ah, the chemistry and their age.

If you cannot find a figure, leave it empty. The check will mark that part "needs review" instead of guessing.

## Rules the check applies
- Anything added must match the system voltage. A 24 V system cannot simply take a 48 V battery.
- Batteries of different chemistries never share a bank. Lithium is offered as a replacement for a lead-acid bank, not an addition to it.
- New lead-acid batteries joined to an old bank are dragged down to its condition. For an aged bank, replacing it is usually better.
- More panels must fit the controller's or inverter's voltage window and power limit. If it is full, the check offers a larger controller or inverter together with the panels.

## Always
The existing equipment has not been inspected by the company. A technician must verify the ratings before any quotation from an upgrade check can be approved.`
      },
      {
        key: "m3-l4",
        title: "From sizing to an illustrative quotation",
        body: `A quotation in Solar Switch moves through fixed steps. Knowing them lets you tell the customer exactly what happens next.

## 1. Draft
You create the quotation from a sizing configuration or from an upgrade study. The app prices each product from the catalogue. You may add services such as installation.

## 2. Illustrative
You can show or send the customer an illustrative quotation straight away. Every page carries the words "UNVERIFIED - FOR ILLUSTRATION ONLY". It is a guide to help them decide, not an offer.

## 3. Technical review
You submit it. A technician checks the load, the battery, the panels, the inverter and the site notes against a checklist, and approves it, sends it back for revision or rejects it. You cannot approve your own design.

## 4. Commercial approval
Needed only when a price is below the floor or the quotation has unusual terms. A manager decides.

## 5. Official issue
Only an approved revision can be issued. The app gives it an official number and a validity date, and holds the stock for it.

## If something changes
Changing products, quantities, prices or terms creates a new revision, and earlier approvals no longer apply. That protects you and the customer: what was approved is exactly what is issued.

Tell the customer the truth about where they are: "This is our estimate. Our technician reviews it, then you receive the official quotation."`
      }
    ],
    questions: [
      {
        key: "m3-q1",
        prompt: "Where is the best place to get an appliance's power in watts?",
        options: ["The customer's memory", "The nameplate on the appliance", "A neighbour's similar appliance", "Any number that keeps the system small"],
        correctIndex: 1,
        explanation: "A nameplate figure is better than a typical or remembered one, and the app records the source."
      },
      {
        key: "m3-q2",
        prompt: "Why does the time of day an appliance runs matter?",
        options: [
          "It does not matter",
          "Daytime use can come straight from the panels, while night use must come from the battery",
          "Appliances use less power at night",
          "The tariff is always lower at night"
        ],
        correctIndex: 1,
        explanation: "Night loads decide battery size; daytime loads can be served directly by solar."
      },
      {
        key: "m3-q3",
        prompt: "A sizing check shows \"needs review\". What does that mean?",
        options: [
          "It is probably fine, so carry on",
          "The configuration has failed",
          "A technician must confirm it; it cannot be treated as a pass",
          "The customer must pay a deposit first"
        ],
        correctIndex: 2,
        explanation: "Something could not be validated. Only a technician can resolve it."
      },
      {
        key: "m3-q4",
        prompt: "A customer with a 48 V lead-acid bank wants longer backup and likes lithium. What does the upgrade check offer?",
        options: [
          "Adding one lithium battery beside the lead-acid ones",
          "Replacing the bank with lithium, since different chemistries never share a bank",
          "Changing the system to 12 V",
          "Nothing; lithium cannot be used on an existing system"
        ],
        correctIndex: 1,
        explanation: "Chemistries are never mixed in one bank. Lithium is offered as a whole-bank replacement."
      },
      {
        key: "m3-q5",
        prompt: "You cannot find the maximum solar voltage on an old charge controller. What do you enter in the upgrade check?",
        options: [
          "A typical value from another controller",
          "The highest number allowed",
          "Leave it empty, so that part is marked for a technician to confirm",
          "The battery voltage"
        ],
        correctIndex: 2,
        explanation: "A missing rating means \"cannot validate\". Never invent a specification."
      },
      {
        key: "m3-q6",
        prompt: "What must appear on every page of a quotation that has not been approved and issued?",
        options: [
          "The agent's commission",
          "\"UNVERIFIED - FOR ILLUSTRATION ONLY\"",
          "The floor price",
          "The technician's phone number"
        ],
        correctIndex: 1,
        explanation: "Illustrative quotations are always marked so they are never mistaken for an official offer."
      }
    ]
  },
  {
    key: "m4",
    title: "Presenting, closing and selling ethically",
    summary:
      "How to present a proposal, answer the usual objections, close properly and keep to the rules that protect the customer and the company.",
    passPercent: 80,
    lessons: [
      {
        key: "m4-l1",
        title: "Presenting the proposal",
        body: `The customer does not want panels. They want lights that stay on, stock that does not spoil, or a smaller bill. Present the answer to their problem.

## Start from what they told you
"You said you spend about this much a month and the power goes off most evenings." Show that you listened before you show a price.

## Show today against tomorrow
Use the figures from the assessment: what they use each day, what it costs them now, what the system would supply, and how long the backup lasts for their critical loads. Use the numbers on the quotation. Do not add better ones from your head.

## Explain what is included
Go through the lines: panels, inverter, batteries, mounting, protection, cables, installation. Explain the warranty on each product as it is written. If something is not included, say so now, not after they pay.

## Offer a choice where there is one
Customers decide more easily between options than between yes and no: for example a system for the critical loads now, with room to add panels or batteries later.

## Say where it stands
If the quotation is illustrative, say it has still to be verified by a technician and that the official quotation follows. Customers respect a clear process.

Then stop talking and let them ask questions.`
      },
      {
        key: "m4-l2",
        title: "Handling common objections",
        body: `An objection is a question the customer has not finished asking. Answer it honestly.

## "It is too expensive"
Compare it with what they already pay: monthly electricity, generator fuel, spoiled stock. Show the instalment calculation if financing is available to them. Offer a smaller first step that can grow. Do not cut the price beyond what you are allowed, and do not remove safety parts to make it cheaper.

## "I can buy cheaper parts in town"
Perhaps. Ask what is included: is it sized for their load, are the parts compatible, who installs it, and who answers when it fails? A matched, verified system with a warranty is a different product from loose parts.

## "Solar does not work when it rains"
It produces less on dark days, and the system is sized with conservative sun hours for that reason. With a hybrid system the grid fills the gap. Be honest: a long run of bad weather reduces output for any system.

## "Batteries die quickly"
Batteries wear with use. How long they last depends on the chemistry, how deeply they are discharged and the manufacturer's rated cycles. Show them the figures on the product, and explain how the system is sized to stay within them.

## "Let me think about it"
That is fair. Ask what they would like to think over, answer it if you can, and agree a day to speak again. Then follow up on that day.

Never answer an objection with a promise the quotation does not make.`
      },
      {
        key: "m4-l3",
        title: "Closing and after the yes",
        body: `Closing is simply asking for the decision when the customer has what they need to make it.

## Ask clearly
"Shall we go ahead with this option?" If the answer is not yet, find out what is missing: a figure, a person who must agree, or the money.

## Record it properly
- Only an officially issued quotation can be accepted. If the customer agrees to an illustrative one, your next step is to get it reviewed and issued.
- Record the acceptance in the app. That opens the installation job and holds the goods for the customer.
- Payment terms, deposits and instalments are the ones the company has approved. Do not agree private arrangements.
- If the customer declines, record that too, with the reason. It teaches the whole team.

## Before installation
Confirm the date, who will be on site, where the equipment will go and anything the customer must prepare. Tell the technician everything you learned on your visits.

## At handover
Make sure the customer is shown how to read the inverter, what the system can and cannot run, what to do in a fault and who to call. Explain the warranties again.

## Afterwards
Call after a week and after a month. A customer who feels looked after gives you your next three leads. Ask for the referral, and ask permission to use their name.`
      },
      {
        key: "m4-l4",
        title: "Rules you never break",
        body: `These rules protect the customer, the company and you. They are not negotiable, however close the sale is.

- Never present an illustrative quotation as official, and never remove or hide the "UNVERIFIED" marking.
- Never promise savings, backup hours or performance that are not on the quotation.
- Never invent a specification or tell a customer that parts are compatible when the app says it cannot validate them.
- Never approve your own design. Technical approval belongs to a technician who is not the quotation's owner.
- Never give a discount beyond your authority. Prices below the floor need a manager's approval.
- Never promise stock or a delivery date the system has not confirmed. Stock is held only when a quotation is officially issued.
- Never pressure or mislead. No false deadlines, no frightening people, no hiding costs.
- Never take payment outside the company's approved process.
- Never share or misuse customer information.
- If you see something unsafe at a site, such as damaged cables, overheated batteries or exposed connections, tell the customer and report it to a technician.
- If you do not know the answer to a technical question, say so and bring in a technician.

## Why it matters
One customer who was told the truth and got what was promised brings more business than ten who were oversold. A certified Solar Switch agent is someone a customer can believe.`
      }
    ],
    questions: [
      {
        key: "m4-q1",
        prompt: "What is the best way to open a proposal presentation?",
        options: [
          "With the total price",
          "With the technical specifications of the inverter",
          "By repeating the problem the customer told you about",
          "By criticising other companies"
        ],
        correctIndex: 2,
        explanation: "Start from their problem so the proposal is clearly an answer to it."
      },
      {
        key: "m4-q2",
        prompt: "A customer says the system is too expensive. Which response is acceptable?",
        options: [
          "Remove the breakers and surge protection to lower the price",
          "Give any discount needed to close today",
          "Compare with what they spend now and offer a smaller first step that can grow",
          "Promise the system will pay for itself in six months"
        ],
        correctIndex: 2,
        explanation: "Reframe against current costs and offer a phased option. Never remove safety parts or exceed your discount authority."
      },
      {
        key: "m4-q3",
        prompt: "A customer agrees to an illustrative quotation and wants to pay now. What do you do?",
        options: [
          "Take the money and install",
          "Submit it for technical review so it can be approved and officially issued first",
          "Edit the PDF to remove the watermark",
          "Approve it yourself to save time"
        ],
        correctIndex: 1,
        explanation: "Only an officially issued quotation can be accepted. It must be reviewed and issued first."
      },
      {
        key: "m4-q4",
        prompt: "Who may give technical approval for your quotation?",
        options: [
          "You, if you are confident",
          "The customer",
          "A technician who is not the owner of the quotation",
          "Any sales agent"
        ],
        correctIndex: 2,
        explanation: "An agent can never approve their own design."
      },
      {
        key: "m4-q5",
        prompt: "The customer wants a price below the floor price. What happens?",
        options: [
          "You may agree if the sale is large",
          "It needs a manager's commercial approval",
          "The technician decides",
          "The app applies it automatically"
        ],
        correctIndex: 1,
        explanation: "Prices below the floor, and unusual terms, require a manager's approval."
      },
      {
        key: "m4-q6",
        prompt: "During a visit you notice scorched cables on the customer's existing system. What should you do?",
        options: [
          "Ignore it; it is not your installation",
          "Fix it yourself",
          "Tell the customer and report it to a technician",
          "Use it to frighten the customer into buying"
        ],
        correctIndex: 2,
        explanation: "Safety problems are reported honestly and passed to a technician."
      }
    ]
  }
];
