# Fortune's Foundation Rules

## deck
modified tarot deck:
major arcana:
22 cards 0 - 21
minor arcana: 
4 * 13 cards ace through king
minor ranks are 1 through 13:
ace = 1, jack = 11, queen = 12, king = 13
suits: cups (red), swords (blue), stars (yellow), thorns (green)

## board

11 tableau columns, which hold a stack of cards

4 minor foundations, one for each suit
stack of minor cards of a single suit in order ace through king

low major foundation
stack of major cards going up starting at 0

high major foundation
stack of major cards going down starting at 21

park can hold any single card

## initial position

low and high major foundation empty

minor foundations each contain only ace of their color

the four aces are removed before dealing
the remaining 70 cards are shuffled and dealt into tableau columns

columns 0 through 4 contain 7 cards
column 5 contains 0 cards
columns 6 through 10 contain 7 cards

park is empty

## manual moves

only the top card of each tableau column and the park card can be moved

the card can go in the park, if the park is empty
the card can go in an empty tableau column
the card can stack on top of another card in a tableau column iff:
- both cards are minor cards of the same suit, and their minor ranks differ by exactly 1.
- both cards are major cards, and their major ranks differ by exactly 1.

stacking in tableau columns can go up or down

the player can never move a card to a foundation manually
moving the park card to a tableau column is a manual move

## automatic moves

after each manual move, all cards that can be moved to a foundation will be moved to a foundation automatically
automatic moves repeat until no eligible foundation move remains
scan order is park, then tableau columns left-to-right
only the top card of each tableau column and the park card can be moved

0 major will be moved to low foundation if its empty
21 major will be moved to high foundation if its empty
a major card will move to low foundation if its rank is 1 higher than the top of low foundation
a major card will move to high foundation if its rank is 1 lower than the top of high foundation

a minor card will move to its suit's minor foundation if its rank is 1 higher than the top of its suit's minor foundation and there is no card in park
the park blocks all minor foundation moves
the park card can move to foundation automatically under the same rules

## win condition

the game is won iff
- every tableau column is empty.
- the park is empty.
- each minor foundation contains all 13 cards of its suit in ascending rank order from 1 through 13.
- the low major foundation and high major foundation together contain all 22 major cards.
