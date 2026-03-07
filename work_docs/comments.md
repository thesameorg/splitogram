- add "dummy" users so they can be added to the group later - or even not added, just maintained by other users in group, if they don't want to use the app
    - who has a right to do anything for them?
    - how do they settle?
    - how will a user "join" the group later and get all records from dummy? probably invite for a dummy user with a personal deep link?
    - what if he joins with a regular link? maybe use telegram IDs - like ID & username? + flag of "real" user?
    - 

- somehow when bot added to group, make dummies for all its users (if group admin decides to do so)
- add max 1 usdt update of "charge" besides of minimum
- check if contract has loopholes and can be exploited
- add "version" to account page
- we need to somehow differenciate if settlement recepient has a connected wallet, and what to do if not?
    - prompt him to do so?
    - but what about timing?
    - 

- when settiling:
    - we need to clearly and directly explain what is going on. 
        - why and where money is going.
        - how should the transaction confirmation screen look?
        - why address is different
        - that he'll be prompted to manually confirm action in his wallet
    - what should user do if not prompted?
    - what do WE do if user should get prompt, but did not?
    - need to clearly process both happy and negative scenarios
        - user declined
        - timed out
        - not enough money
        - not enough gas
        - what else? 
        - TON-api (wallet API) timeouts - we need to be sure we have correct confirmation mechanism with retries & backoff and such
        - maybe preliminalry check that APIs we use work?
        - preliminary check that user has enough gas + USDT?
        - 



# LATER
- add TON contract + oracle
- add contracts for other jettons