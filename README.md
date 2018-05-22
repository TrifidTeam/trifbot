trifbot
============================

Message from the Trifid Team
----------------------------    
The Trifid Team developed this NTP1 token tipbot on-chain to encourage usage of NTP1 tokens and wider adoption. Many of the functions within can be used outside of this application, and we encourage the community to submit issues and updates to the bot to improve its usage and functionality.


Who wrote it ?
---------------------------- 
Author:<br />
    joe@trifidtoken.com

Tip here if you find it useful:<br />
    NMi41ze2XnxJrMNGtSGheGqLR3h4dabREW (NEBL or NTP1 Tokens!)


Overview
---------------------------- 

**How it works**<br />
At the highest level, the bot uses one HD wallet seed and assigns users within a slack community to various addresses within that wallet. The main (index 0) address holds NEBL, and that NEBL is used as transaction fees for all NTP1 transactions. Each user is assigned an address within the wallet, and their tokens reside on that address. Transactions happen on-chain. Users are free to withdraw and deposit NTP1 tokens to their addresses freely as they choose.

**There are four main components to trifbot:**<br />
1.  PostgreSQL Database
    User ids, addresses, and private keys reside in a psql database. Initially, the list can be generated using a new orion wallet and the bip39 tool. A sample .csv file is provided in our repository with testnet addresses and private keys. You will see that index 0 has the userid 'MAIN', which is what the code refers to the NEBL address by.
    *   http://www.yolinux.com/TUTORIALS/LinuxTutorialPostgreSQL.html
    *   https://github.com/NeblioTeam/bip39

2.  Slack integration<br />
    Trifbot uses slack's Real Time Messaging API.
    *   https://api.slack.com/bot-users
    *   https://api.slack.com/rtm

3.  Environment variables<br />
    dotenv was used to store variables that should be hidden from the public eye. These need to be set in the '.env' file per the parameters in the '.env.default' file. The values are:
    *   BOT_NETWORK = *this is MAINNET or TESTNET*
    *   SLACK_BOT_TOKEN = *this is from your slack bot integration and looks like xoxb-####...*
    *   DB_USER = *username for psql -- this might be 'postgres'*
    *   DB_PASSWORD = *password for above user*
    *   DB_HOST = *username for psql -- this might be 'localhost'*
    *   DB_DATABASE = *database name for psql -- you set this up initially when you built the db and table*
    *   DB_PORT = *port for psql. default is '5432'*
    *   Info on dotenv: https://www.npmjs.com/package/dotenv


4.  Javascript core program<br />
    The javascript index.js weaves it all together. This includes the code for connection to slack, sql commands, NTP1 api commands, NTP1 token transaction rules, and the parsing logic for slack messages.

Instructions for Deployment
---------------------------- 

1.  Wallet Creation<br />
    Create your orion address and use bip39 to generate a lot of address/pvtkey pairs. I recommend at least 5000 but you should judge it by how large your slack workspace might get. Move those into a .csv file like (index,userid,address,pvtkey). The userid column should be blank other than index 0 should be set to MAIN.

2.  pSQL Database Setup<br />
    Set up your pSQL database and table built. Follow instructions in the `pSQL setup commands.txt` file included in this repo.

3.  Slack bot user creation<br />
    Create your bot user in slack and get the tokenid. The links above provide instruction.

4.  Environment variables setup<br />
    Fill out the .env file.

5.  Determine which channel you'll be using -- that is channelid in the .js file

6.  Run index.js<br />
    When the program runs, it does an initial validation of all users and assigns them to addresses in the database. From now on, it will start with those values but will re-validate each time the program starts.
