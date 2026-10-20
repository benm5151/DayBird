// What each common Upper Valley bird is up to right now: when it is here, and what it is doing in its life each season.
// Hand-written by Daybird for Lebanon / Hanover NH and the Vermont side of the river from field guides, All About Birds
// and eBird bar charts; NOT yet checked by an expert birder. Months are "you can reasonably expect to see one", not
// "a record exists". Species names are eBird common names and match data/traits.js.
//
// Shape: DAYBIRD_STATUS.species = { <name>: { type, months, seasons } }
//   type    — 'resident' (here all year) | 'summer' (breeds here, leaves) | 'winter' (here in the cold months) | 'migrant' (passes through)
//   months  — [1..12] the months it is normally present
//   seasons — { spring, summer, fall, winter }: one sentence each on what the bird is doing then
//             (spring Mar–May, summer Jun–Aug, fall Sep–Nov, winter Dec–Feb)
// Helper: DAYBIRD_STATUS.now(name, date) → { word, line, season, present, type, months } or null when we have no entry.
//   word is derived from type and months: "Here all year", "Arriving", "Peaking", "Leaving", "Here for the summer",
//   "Here for the winter", "Passing through", "Gone until April".
// To add a bird: add an entry with all four seasons and months within 1–12; `node --test tests/` checks the shape.
globalThis.DAYBIRD_STATUS = (() => {
  const species = {
    'Black-capped Chickadee': { type: 'resident', months: [1,2,3,4,5,6,7,8,9,10,11,12], seasons: {
      spring: 'Pairs split off from the winter flock and the male whistles his two-note "fee-bee" while they hunt for a rotten stub to dig a nest hole in.',
      summer: 'Feeding six to eight nestlings on caterpillars, then shepherding a noisy, begging family group through the woods in July.',
      fall: 'Back in flocks of a dozen with titmice, nuthatches and kinglets tagging along, hiding seeds in bark crevices for the winter.',
      winter: 'Working the same flock territory every day, fluffed against the cold and down to a few remembered seed caches when the feeders are empty.' } },
    'Tufted Titmouse': { type: 'resident', months: [1,2,3,4,5,6,7,8,9,10,11,12], seasons: {
      spring: 'Singing "peter-peter-peter" from late February, nesting in an old woodpecker hole lined with fur it sometimes plucks from live animals.',
      summer: 'Quietly raising one brood, the fledglings following the parents and begging through July.',
      fall: 'Joining the chickadee flocks and carrying sunflower seeds off one at a time to hide them.',
      winter: 'A regular at the feeder all winter, often the first bird to scold a hawk or an owl.' } },
    'White-breasted Nuthatch': { type: 'resident', months: [1,2,3,4,5,6,7,8,9,10,11,12], seasons: {
      spring: 'Pairs that stay together year-round pick a natural cavity and sweep the entrance with crushed insects, maybe to put off squirrels.',
      summer: 'Feeding young in the hole and then a family group working the trunks together, low on the volume.',
      fall: 'Wedging seeds and nuts into bark to open them, and stashing many more for the months ahead.',
      winter: 'Travelling with the chickadee flock and nasal-calling all day; one of the few birds you can count on in January.' } },
    'Red-breasted Nuthatch': { type: 'resident', months: [1,2,3,4,5,6,7,8,9,10,11,12], seasons: {
      spring: 'Nesting in conifers, smearing sticky resin around the nest hole; some years many, some years almost none.',
      summer: 'Raising young in spruce and hemlock and easy to miss in the valley, since most pairs are up in the hills.',
      fall: 'In a poor cone year up north, dozens pour down into the valley in September; in a good year they stay put and you see few.',
      winter: 'A tin-horn "yank" in the pines and a regular at suet and sunflower in irruption years.' } },
    'Downy Woodpecker': { type: 'resident', months: [1,2,3,4,5,6,7,8,9,10,11,12], seasons: {
      spring: 'Drumming on dead branches and excavating a fresh nest hole in soft wood, often in a small dead tree or a fence post.',
      summer: 'Feeding young, then a scruffy juvenile with a red forehead patch following a parent to the suet.',
      fall: 'Back on its own for the winter, roosting in a hole it digs each autumn and joining chickadee flocks loosely.',
      winter: 'Working goldenrod galls and weed stems as well as trunks; the small woodpecker at the suet all winter.' } },
    'Hairy Woodpecker': { type: 'resident', months: [1,2,3,4,5,6,7,8,9,10,11,12], seasons: {
      spring: 'Louder drumming than the Downy, and a nest hole in a bigger, harder tree, often a live one.',
      summer: 'Feeding nestlings beetle larvae chiselled out of bark; the young follow the parents for a few weeks.',
      fall: 'Scattering back into the bigger woods and digging a winter roost hole.',
      winter: 'A steady visitor to suet, usually alone, and the woodpecker you hear hammering hard on a cold day.' } },
    'Pileated Woodpecker': { type: 'resident', months: [1,2,3,4,5,6,7,8,9,10,11,12], seasons: {
      spring: 'Loud, slow drumming and wild laughing calls as the pair digs a big oval nest hole in a dead tree.',
      summer: 'Raising young in the hole; the parents fly in with beaks full of carpenter ants from rotten logs.',
      fall: 'The young have dispersed and the pair goes back to patrolling a large territory, leaving fresh rectangular holes in dead wood.',
      winter: 'Easy to find by the fresh chips under a stump; it stays all winter and will visit suet in a quiet yard.' } },
    'Northern Flicker': { type: 'summer', months: [3,4,5,6,7,8,9,10,11], seasons: {
      spring: 'Back in late March, calling "wick-wick-wick" from treetops and drumming on anything that resonates, including gutters.',
      summer: 'Nesting in a tree hole and spending much of the day on the ground eating ants, the only woodpecker you will see on a lawn.',
      fall: 'Moving south through September and October, often in small loose groups, flashing white rumps as they fly up from fields.',
      winter: 'Mostly gone south; a single bird sometimes sticks around a yard with fruit and suet through the cold.' } },
    'Blue Jay': { type: 'resident', months: [1,2,3,4,5,6,7,8,9,10,11,12], seasons: {
      spring: 'Quiet and sneaky while nesting, so a yard full of jays goes silent in May; some birds also migrate north along the river in loose flocks.',
      summer: 'Feeding young in a bulky stick nest, then a loud family group begging in July and August.',
      fall: 'Carrying acorns and beechnuts off by the throatful to bury them, and flocks drifting south along ridges on fine mornings.',
      winter: 'Back at the feeder in a gang, hollering at hawks and digging up the acorns it buried in October.' } },
    'American Crow': { type: 'resident', months: [1,2,3,4,5,6,7,8,9,10,11,12], seasons: {
      spring: 'Pairs building a stick nest high in a conifer, with last year\'s young often helping.',
      summer: 'Feeding nestlings and then fledglings that beg hoarsely for weeks.',
      fall: 'Gathering into bigger and bigger evening flocks that stream to a shared roost at dusk.',
      winter: 'Hundreds, sometimes thousands, roosting together in town at night and spreading out to fields and dumpsters by day.' } },
    'Common Raven': { type: 'resident', months: [1,2,3,4,5,6,7,8,9,10,11,12], seasons: {
      spring: 'Nesting early, often on a cliff ledge or a tall pine, with eggs by March while there is still snow.',
      summer: 'Fledged young croaking and tumbling in the air with their parents over ridges.',
      fall: 'Young ravens wandering widely and showing up over town more often.',
      winter: 'Patrolling roadsides for carcasses and soaring over the hills in pairs, croaking.' } },
    'American Robin': { type: 'resident', months: [1,2,3,4,5,6,7,8,9,10,11,12], seasons: {
      spring: 'Males singing before dawn from March, and the first mud-and-grass nests on branches and porch lights by April.',
      summer: 'Raising two or three broods, the spotted-breasted juveniles hopping awkwardly on lawns.',
      fall: 'Switching from worms to fruit and gathering into flocks that work crabapples and sumac.',
      winter: 'Most leave, but flocks stay wherever there is fruit, so a robin in January is not out of place.' } },
    'Eastern Bluebird': { type: 'summer', months: [3,4,5,6,7,8,9,10,11], seasons: {
      spring: 'Back in March, claiming nest boxes and old fence-post holes and warbling softly from wires.',
      summer: 'Raising two broods in boxes; watch for the young of the first brood helping to feed the second.',
      fall: 'Family groups roaming fields and orchards together and drifting south through October and November.',
      winter: 'Mostly gone, though small flocks sometimes stay near berries and sheltered boxes.' } },
    'Hermit Thrush': { type: 'summer', months: [4,5,6,7,8,9,10,11], seasons: {
      spring: 'Back in mid-April, the first thrush to return, singing a clear ethereal song in damp woods at dawn and dusk.',
      summer: 'Nesting on the ground or low in a hemlock, feeding young and singing less by July.',
      fall: 'The last thrush to leave; October birds stop in brushy edges and even yards, flipping leaves and slowly raising the tail.',
      winter: 'Gone south to the southern states, though one occasionally overwinters near fruit.' } },
    'Gray Catbird': { type: 'summer', months: [5,6,7,8,9,10], seasons: {
      spring: 'Back in early May, mewing from thickets and running through a long jumbled song.',
      summer: 'Nesting low in dense shrubs and raising two broods; the parents scold anyone who comes near.',
      fall: 'Quiet and eating berries in September, gone by mid-October.',
      winter: 'On the Gulf Coast and in Central America; not here.' } },
    'European Starling': { type: 'resident', months: [1,2,3,4,5,6,7,8,9,10,11,12], seasons: {
      spring: 'The bill turns yellow and the speckles wear off to glossy purple-green; pairs squabble over any hole in a building or tree.',
      summer: 'Feeding noisy brown juveniles that look like a different bird, then gathering in flocks on lawns.',
      fall: 'Fresh molt brings back the white speckles; big flocks swirl over fields and roost under bridges.',
      winter: 'Dark-billed and speckled, in tight flocks in town and at feeders.' } },
    'Cedar Waxwing': { type: 'resident', months: [1,2,3,4,5,6,7,8,9,10,11,12], seasons: {
      spring: 'Flocks eating last year\'s fruit and catching insects over the river; among the last birds to start nesting.',
      summer: 'Nesting in June and July, timed to the first berries, and fluttering out over water for insects.',
      fall: 'Big flocks stripping mountain ash, crabapple and dogwood, passing a berry down the line.',
      winter: 'Here if there is fruit, gone if there is not; a flock can appear and vanish the same day.' } },
    'Northern Cardinal': { type: 'resident', months: [1,2,3,4,5,6,7,8,9,10,11,12], seasons: {
      spring: 'Singing loudly from treetops from February, and the male feeding the female seeds beak to beak.',
      summer: 'Two or even three broods in dense shrubs; the brownish juveniles have dark bills.',
      fall: 'Molting into fresh red, the new feathers tipped gray so the male looks dull until the tips wear off.',
      winter: 'Pairs and small groups at feeders at dawn and dusk, the red loudest against snow.' } },
    'Rose-breasted Grosbeak': { type: 'summer', months: [5,6,7,8,9], seasons: {
      spring: 'Arrives in early May, often straight to a feeder, singing a rich song like a robin that took lessons.',
      summer: 'Nesting in deciduous woods and edges; both parents sing, even on the nest.',
      fall: 'Leaving by late September, the males already molting toward a streaky winter look.',
      winter: 'In Central and South America; not here.' } },
    'Purple Finch': { type: 'resident', months: [1,2,3,4,5,6,7,8,9,10,11,12], seasons: {
      spring: 'Singing a rolling warble from conifers and nesting in spruce and fir, more in the hills than in town.',
      summer: 'Raising young in conifers and easy to miss until the family comes to a feeder.',
      fall: 'Numbers at feeders rise as birds move down from the north and the hills.',
      winter: 'Some winters common at feeders, some winters nearly absent, depending on the seed crop up north.' } },
    'House Finch': { type: 'resident', months: [1,2,3,4,5,6,7,8,9,10,11,12], seasons: {
      spring: 'Nesting in hanging planters, wreaths and ivy from April, with a long cheerful warble from rooftops.',
      summer: 'Raising several broods in town; the streaky young crowd the feeders by July.',
      fall: 'In flocks at feeders and on seed heads, staying close to buildings.',
      winter: 'A town bird all winter; the red on the male ranges from orange to deep red depending on diet.' } },
    'American Goldfinch': { type: 'resident', months: [1,2,3,4,5,6,7,8,9,10,11,12], seasons: {
      spring: 'Molting patch by patch from drab olive to bright yellow through April and May, and singing a long twittering song.',
      summer: 'Among the last songbirds to nest, waiting for thistle down in July; the young beg well into September.',
      fall: 'Molting back to olive-brown and gathering into flocks on seed heads and feeders.',
      winter: 'Dull and easy to overlook, in flocks at thistle feeders; the same bird as the summer canary.' } },
    'Pine Siskin': { type: 'winter', months: [10,11,12,1,2,3,4], seasons: {
      spring: 'Flocks linger at feeders into April and some years a few stay to nest in conifers.',
      summer: 'Mostly north of here in the boreal forest; one in July is unusual but not impossible.',
      fall: 'In a poor cone year up north, flocks arrive in October and pile onto thistle feeders; in a good year, almost none come.',
      winter: 'Here in irruption winters by the dozen, often with goldfinches, wheezing and squabbling at the feeder.' } },
    'House Sparrow': { type: 'resident', months: [1,2,3,4,5,6,7,8,9,10,11,12], seasons: {
      spring: 'Males with fresh black bibs chirping endlessly from gutters and stuffing nests into any gap in a building.',
      summer: 'Several broods in a row, the whole colony noisy around barns and shopping centers.',
      fall: 'Fresh molt dulls the bib to gray-tipped; flocks dust-bathe and feed on spilled grain.',
      winter: 'In chattering flocks in hedges and under eaves, never far from people.' } },
    'Song Sparrow': { type: 'summer', months: [3,4,5,6,7,8,9,10,11], seasons: {
      spring: 'One of the first singers back in March, each male with his own set of songs from a low perch.',
      summer: 'Raising two or three broods in a nest on or near the ground in a brushy edge.',
      fall: 'Moving south in October, with many migrants from farther north passing through weedy fields.',
      winter: 'Mostly gone, but a few tough birds stay around feeders and open brush all winter.' } },
    'White-throated Sparrow': { type: 'migrant', months: [4,5,9,10,11], seasons: {
      spring: 'Passing through from mid-April to mid-May, whistling "Oh sweet Canada" from the brush before heading north and uphill to nest.',
      summer: 'Nesting in the spruce-fir hills and the North Country, with a few pairs in cooler corners of the valley.',
      fall: 'The peak: October flocks of first-winter birds in brown and tan arrive from Canada, scratching in leaf litter at brushy edges and under feeders.',
      winter: 'Most go south to the mid-Atlantic, but a few stay all winter at feeders with the juncos.' } },
    'White-crowned Sparrow': { type: 'migrant', months: [5,9,10], seasons: {
      spring: 'A brief window in early to mid-May; look for the puffy striped crown in a weedy edge or under a feeder for a day or two.',
      summer: 'Far to the north, breeding in Canada and Alaska; not here.',
      fall: 'Late September and October, mixed into the white-throated flocks in brushy fields and yards; the young have brown and tan stripes.',
      winter: 'South of here, in the mid-Atlantic and beyond.' } },
    'Dark-eyed Junco': { type: 'winter', months: [9,10,11,12,1,2,3,4], seasons: {
      spring: 'Trilling from treetops in March and April before most leave for the hills and the north; a few nest on the ridges above the valley.',
      summer: 'Nesting on the ground in cool, high woods, mostly up in the mountains; a valley yard is empty of them.',
      fall: 'Arriving in late September and October, flocks spread out under feeders and along road edges, flashing white tail edges.',
      winter: 'The classic snowbird: on the ground under the feeder all winter, with each flock keeping to its own patch.' } },
    'Chipping Sparrow': { type: 'summer', months: [4,5,6,7,8,9,10], seasons: {
      spring: 'Back in mid-April with a dry trill from a conifer top and a nest lined with hair in a spruce or a hanging plant.',
      summer: 'Raising two broods around lawns and gardens; the young are streaky and lack the rusty cap.',
      fall: 'In small flocks in weedy fields through October, with duller, browner caps.',
      winter: 'In the southern states and Mexico; not here.' } },
    'Mourning Dove': { type: 'resident', months: [1,2,3,4,5,6,7,8,9,10,11,12], seasons: {
      spring: 'Cooing from wires and building flimsy stick nests from March, often on a branch or a gutter.',
      summer: 'Up to five or six broods of two, fed on crop milk; the parents hardly stop.',
      fall: 'Flocks gather on wires and in fields of spilled grain, many moving south.',
      winter: 'Smaller flocks stay on in yards and at feeders, wings whistling when they flush.' } },
    'Red-winged Blackbird': { type: 'summer', months: [3,4,5,6,7,8,9,10], seasons: {
      spring: 'The first males are back in early March, "konk-la-ree" from cattail tops before the ice is gone; the females follow weeks later.',
      summer: 'Nesting in marshes and wet fields and dive-bombing anyone who walks past the nest.',
      fall: 'Gathering into huge mixed flocks with grackles and cowbirds and heading south through October.',
      winter: 'Mostly gone; a handful sometimes winter at feeders or in big blackbird roosts to the south.' } },
    'Common Grackle': { type: 'summer', months: [3,4,5,6,7,8,9,10], seasons: {
      spring: 'Back in March in noisy flocks, strutting on lawns and nesting in colonies in conifers.',
      summer: 'Feeding young on almost anything, and taking over feeders in gangs.',
      fall: 'Massing into flocks of hundreds with other blackbirds, then leaving through October.',
      winter: 'South of here in giant roosts; a straggler at a feeder is possible but unusual.' } },
    'Brown-headed Cowbird': { type: 'summer', months: [3,4,5,6,7,8,9,10], seasons: {
      spring: 'Back in March; the female watches other birds build and lays an egg in their nest, up to forty a season.',
      summer: 'Not raising young at all; the host birds do that, and you may see a huge cowbird chick with a small warbler parent.',
      fall: 'In mixed blackbird flocks in fields and leaving through October.',
      winter: 'Mostly gone south, with a few in winter blackbird flocks and at feeders.' } },
    'Baltimore Oriole': { type: 'summer', months: [5,6,7,8,9], seasons: {
      spring: 'Arrives in the first week of May, whistling from the tops of leafing-out trees and coming to oranges and jelly.',
      summer: 'Weaving a hanging pouch nest near the tip of a branch and feeding young on caterpillars; quiet by July.',
      fall: 'Gone by mid-September, after a brief return to feeders while fattening up.',
      winter: 'In Central America and the Caribbean; not here.' } },
    'Yellow-rumped Warbler': { type: 'migrant', months: [4,5,9,10,11], seasons: {
      spring: 'The first warbler back in late April, often in numbers, flashing yellow rumps along the river.',
      summer: 'Most are north of here in the boreal forest; a few pairs nest in spruce and hemlock in the hills, so one in July is not a mistake.',
      fall: 'The commonest warbler by far in late September and October, in loose flocks eating berries and insects at edges, and the last warbler to leave.',
      winter: 'Gone south to the coast, where it lives on bayberries; one occasionally lingers into December.' } },
    'Palm Warbler': { type: 'migrant', months: [4,5,9,10], seasons: {
      spring: 'Late April and early May, pumping its tail along field edges and lawns on the way north.',
      summer: 'Nesting in bogs across Canada; not here.',
      fall: 'Mid-September to mid-October, in weedy fields and low shrubs, often on the ground with sparrows.',
      winter: 'In the southern states; not here.' } },
    'Ruby-crowned Kinglet': { type: 'migrant', months: [4,5,9,10], seasons: {
      spring: 'Passing through from mid-April to mid-May, with a surprisingly loud song for a bird this size.',
      summer: 'Nesting in spruce forests to the north and in the mountains; rare in the valley.',
      fall: 'Late September and October, flicking through shrubs and low branches, often with chickadee flocks.',
      winter: 'Gone south; a few try to winter and rarely make it through.' } },
    'Golden-crowned Kinglet': { type: 'resident', months: [1,2,3,4,5,6,7,8,9,10,11,12], seasons: {
      spring: 'Migrants pass through in April; local pairs are singing thin, rising songs in spruce stands.',
      summer: 'Nesting high in dense conifers, mostly in the hills, where it is almost impossible to see.',
      fall: 'October brings flocks down into the valley, working the tips of hemlock branches with chickadees.',
      winter: 'A few stay all winter in conifer stands, surviving nights far below zero on almost nothing.' } },
    'Carolina Wren': { type: 'resident', months: [1,2,3,4,5,6,7,8,9,10,11,12], seasons: {
      spring: 'Singing "tea-kettle" from February and nesting in odd places: a flowerpot, a boot, a garage shelf.',
      summer: 'Raising two broods near houses and scolding from brush piles.',
      fall: 'Young birds spreading out and finding new yards to claim; this is when a new pair shows up.',
      winter: 'Stays all year and sings on warm days; a hard winter with ice can wipe out the local birds for a year or two.' } },
    'Eastern Phoebe': { type: 'summer', months: [3,4,5,6,7,8,9,10], seasons: {
      spring: 'Back in late March, often the first migrant songbird, saying its name from a bridge or porch beam.',
      summer: 'Two broods in a mud-and-moss nest under an eave or bridge; the parents hawk insects from low perches.',
      fall: 'Lingering into October, quietly pumping its tail at a pond edge, the last flycatcher to leave.',
      winter: 'In the southern states; not here.' } },
    'Tree Swallow': { type: 'summer', months: [4,5,6,7,8,9], seasons: {
      spring: 'The first swallow back, in early April, over ponds and fields before the insects are reliable.',
      summer: 'Nesting in boxes and tree holes; the young crowd the entrance by late June.',
      fall: 'Gathering into flocks on wires in August and gone by mid-September.',
      winter: 'On the Gulf and southern coasts; not here.' } },
    'Barn Swallow': { type: 'summer', months: [4,5,6,7,8,9], seasons: {
      spring: 'Back in late April, pairs swooping into barns and under bridges to rebuild mud cup nests.',
      summer: 'Feeding young in the nest and then teaching them to catch insects over fields.',
      fall: 'Lining up on wires with the young and leaving by early September.',
      winter: 'In South America; not here.' } },
    'Ruby-throated Hummingbird': { type: 'summer', months: [5,6,7,8,9], seasons: {
      spring: 'Arrives in the first or second week of May, straight to the first blooms and any feeder that is out.',
      summer: 'The female raises the young alone in a walnut-sized nest; males guard feeders and flowers.',
      fall: 'Fattening up at feeders and jewelweed and gone by late September; leave the feeder up for stragglers.',
      winter: 'In Mexico and Central America; not here.' } },
    'Canada Goose': { type: 'resident', months: [1,2,3,4,5,6,7,8,9,10,11,12], seasons: {
      spring: 'Pairs on every pond by March, the gander hissing at anyone near the nest; migrant flocks pass high overhead.',
      summer: 'Goslings on lawns and shorelines, and adults flightless for a few weeks while they molt.',
      fall: 'V-shaped flocks calling overhead at dusk, mixing local birds with migrants from the north.',
      winter: 'Flocks stay wherever water is open, grazing cornfields and golf courses.' } },
    'Mallard': { type: 'resident', months: [1,2,3,4,5,6,7,8,9,10,11,12], seasons: {
      spring: 'Pairs on small ponds and ditches; the female nests on the ground, often far from water.',
      summer: 'Ducklings in a line behind the female; the males molt into a dull brown and lose their green heads for a while.',
      fall: 'The males grow their bright heads back and flocks gather on the river and larger ponds.',
      winter: 'Wherever the water stays open, often with black ducks and mergansers below the dams.' } },
    'Common Merganser': { type: 'resident', months: [1,2,3,4,5,6,7,8,9,10,11,12], seasons: {
      spring: 'Pairs up the river and on lakes as the ice goes out, nesting in big tree holes near water.',
      summer: 'A female trailing a dozen ducklings on the river, sometimes with adopted extras.',
      fall: 'Numbers building on the Connecticut River as northern birds arrive and ponds freeze.',
      winter: 'The big duck on the open river all winter, diving for fish below the dams.' } },
    'Hooded Merganser': { type: 'summer', months: [3,4,5,6,7,8,9,10,11], seasons: {
      spring: 'Pairs on beaver ponds and wooded streams in March and April, the male fanning his white crest.',
      summer: 'Nesting in tree holes and wood duck boxes; secretive on small wooded ponds with the young.',
      fall: 'Small flocks on ponds and the river in October and November, the peak time to see them.',
      winter: 'Most leave as ponds freeze; a few stay where the river is open.' } },
    'Great Blue Heron': { type: 'summer', months: [4,5,6,7,8,9,10,11], seasons: {
      spring: 'Back as the ice goes out in late March and April, standing in flooded fields and rebuilding stick nests in treetop colonies in swamps.',
      summer: 'Feeding growing young in the colony and stalking the shallows of every pond and river bend.',
      fall: 'Young birds spread out to any water with fish and frogs; adults linger into November.',
      winter: 'Most leave; one or two tough birds stay at open water below dams and springs.' } },
    'Belted Kingfisher': { type: 'summer', months: [4,5,6,7,8,9,10,11], seasons: {
      spring: 'Back when the rivers open in April, rattling along the bank and digging a tunnel nest in a sandy cutbank.',
      summer: 'Feeding young in the burrow and teaching them to dive by dropping dead fish in the water.',
      fall: 'Young birds claim their own stretches of river; the rattle is a common sound along the Connecticut into November.',
      winter: 'Most leave, but a bird stays wherever there is open water with fish, even in January.' } },
    'Red-tailed Hawk': { type: 'resident', months: [1,2,3,4,5,6,7,8,9,10,11,12], seasons: {
      spring: 'Pairs circling and calling over their territory in March and nesting high in a big tree near a field.',
      summer: 'Feeding young in the nest and then the fledglings screaming for food from fence posts in July.',
      fall: 'Migrants from the north drift through along ridges in October and November on top of the local pairs.',
      winter: 'On highway poles and field edges all winter, hunting the open ground for mice and voles.' } },
    'Turkey Vulture': { type: 'summer', months: [3,4,5,6,7,8,9,10,11], seasons: {
      spring: 'Back in mid-March, the first ones tilting over the valley on the first warm south winds.',
      summer: 'Nesting in a cave, a hollow log or an old barn; soaring in loose groups over fields and roads.',
      fall: 'Drifting south in groups along ridges in October, often with hawks.',
      winter: 'Mostly gone, but more stay every year, and a few now winter in the valley around farms and dumps.' } },
    'Bald Eagle': { type: 'resident', months: [1,2,3,4,5,6,7,8,9,10,11,12], seasons: {
      spring: 'Already on eggs by March in a huge stick nest in a tall pine near the river.',
      summer: 'Feeding one or two eaglets that fledge in July, dark brown all over.',
      fall: 'Young birds wandering widely; adults staying near the river as the fish run.',
      winter: 'Along the open river below the dams, perched in tall trees over the water and fishing in the ice gaps.' } },
    'Wild Turkey': { type: 'resident', months: [1,2,3,4,5,6,7,8,9,10,11,12], seasons: {
      spring: 'Toms strutting and gobbling at dawn in April and May; hens slip off to nest alone on the ground.',
      summer: 'Hens with lines of poults crossing roads and feeding in hayfields.',
      fall: 'Flocks of hens and young roaming the woods for acorns and beechnuts, and toms in their own groups.',
      winter: 'Big flocks in fields, under feeders and in cornfields; they roost in tall trees even in deep snow.' } },
    'Cooper\'s Hawk': { type: 'resident', months: [1,2,3,4,5,6,7,8,9,10,11,12], seasons: {
      spring: 'Nesting in a tall tree in the woods or a wooded neighborhood, quietly, in April.',
      summer: 'Feeding young on songbirds, and the fledglings calling from the nest woods in July.',
      fall: 'Migrants from the north pass along ridges in September and October, and young birds show up at feeders.',
      winter: 'The hawk that ambushes the feeder: a sudden rush, a scattering, and a jay or a dove missing.' } },
    'Red-bellied Woodpecker': { type: 'resident', months: [1,2,3,4,5,6,7,8,9,10,11,12], seasons: {
      spring: 'Calling a rolling "churr" and digging a nest hole in a dead tree or limb; a bird that has moved north into the valley in the last twenty years.',
      summer: 'Feeding young and then a juvenile with a plain gray head following a parent.',
      fall: 'Stashing acorns and seeds in bark crevices and visiting feeders more.',
      winter: 'A regular at suet and sunflower all winter where there is a pair; still uncommon in the hills.' } },
    'Sharp-shinned Hawk': { type: 'resident', months: [1,2,3,4,5,6,7,8,9,10,11,12], seasons: {
      spring: 'Nesting secretly in dense conifers, mostly in the hills; migrants pass north in April.',
      summer: 'Feeding young on small songbirds caught in the woods; rarely seen until the fledglings start calling in July.',
      fall: 'The peak: hundreds stream south along ridges in September and October, and young birds hunt at feeders.',
      winter: 'A few stay, hunting feeders in town; a small hawk flashing through the yard in January is usually this or a Cooper\'s.' } },
    'Broad-winged Hawk': { type: 'summer', months: [4,5,6,7,8,9], seasons: {
      spring: 'Back in mid-April, whistling a thin two-note call over the woods and nesting in a big tree well inside the forest.',
      summer: 'Hunting frogs, snakes and mice from a perch under the canopy; quiet and easy to miss.',
      fall: 'Mid-September is the show: kettles of dozens or hundreds spiral up on a thermal and glide south, all within a few days.',
      winter: 'In Central and South America; not here.' } },
    'American Black Duck': { type: 'resident', months: [1,2,3,4,5,6,7,8,9,10,11,12], seasons: {
      spring: 'Pairs on beaver ponds and marshes by March; nesting on the ground in thick cover.',
      summer: 'Broods on quiet marshes and wooded ponds; the adults molt and hide in July.',
      fall: 'Flocks build on the river and larger marshes in October and November as birds arrive from the north.',
      winter: 'With the mallards wherever the river stays open, often the darker birds at the back of the flock.' } },
    'Yellow Warbler': { type: 'summer', months: [5,6,7,8,9], seasons: {
      spring: 'Back in early May, singing "sweet-sweet-sweet, I\'m so sweet" from willows and streamside shrubs.',
      summer: 'Nesting low in a shrub near water, and building a new floor over a cowbird egg when one appears.',
      fall: 'One of the first warblers to leave; most are gone by the end of August, with stragglers into September.',
      winter: 'In Central and South America; not here.' } },
    'Pine Warbler': { type: 'summer', months: [4,5,6,7,8,9,10], seasons: {
      spring: 'Back in mid-April, early for a warbler, trilling from the tops of white pines and sometimes coming to suet in a cold snap.',
      summer: 'Nesting high in pines and rarely leaving them; the trill is easier to find than the bird.',
      fall: 'Lingering into October in pine stands, duller and browner, with a few at feeders before they go.',
      winter: 'In the southeastern states; a rare one tries to winter at a suet feeder.' } },
    'Wood Thrush': { type: 'summer', months: [5,6,7,8,9], seasons: {
      spring: 'Back in early May, the flute song ringing through deciduous woods at dawn and dusk.',
      summer: 'Nesting in a sapling a few feet up and feeding young from the leaf litter; singing stops by late July.',
      fall: 'Quiet and eating fruit in September, gone by the end of the month.',
      winter: 'In Central America; not here.' } },
    'Veery': { type: 'summer', months: [5,6,7,8,9], seasons: {
      spring: 'Arrives in mid-May and starts the spiraling, downward song in damp woods at dusk.',
      summer: 'Nesting on or near the ground in wet, shrubby woods; the song fades by mid-July.',
      fall: 'Slipping south in late August and early September, almost silent.',
      winter: 'In the Amazon basin in Brazil; not here.' } },
    'Eastern Wood-Pewee': { type: 'summer', months: [5,6,7,8,9], seasons: {
      spring: 'Back in mid-May, among the last migrants, calling "pee-a-wee" from the canopy.',
      summer: 'Sallying out from a dead branch high in the woods all summer, and still singing in the heat of July when most birds have stopped.',
      fall: 'Quietly leaving through September.',
      winter: 'In South America; not here.' } },
    'Eastern Kingbird': { type: 'summer', months: [5,6,7,8,9], seasons: {
      spring: 'Back in early May, perched on fence posts and treetops at field edges and chasing crows twice its size.',
      summer: 'Nesting in an open tree near water or a field, and hawking insects from an exposed perch.',
      fall: 'Gathering into loose flocks and eating fruit in August, gone by early September.',
      winter: 'In South America, eating fruit in flocks; not here.' } },
    'Chimney Swift': { type: 'summer', months: [5,6,7,8,9], seasons: {
      spring: 'Back in early May, twittering high over town and dropping into chimneys at dusk.',
      summer: 'Nesting inside chimneys and hollow trees, a half-cup of twigs glued with saliva; aloft all day.',
      fall: 'Flocks funnel into a big roost chimney at dusk in late August and September, then leave.',
      winter: 'In the Amazon basin; not here.' } },
    'House Wren': { type: 'summer', months: [5,6,7,8,9], seasons: {
      spring: 'Back in early May, bubbling from a brush pile and stuffing twigs into every box and crevice in the yard.',
      summer: 'Two broods in a box or a hole; the male sometimes punctures other birds\' eggs nearby.',
      fall: 'Quiet and skulking in September, gone by early October.',
      winter: 'In the southern states and Mexico; not here.' } },
    'Ring-billed Gull': { type: 'resident', months: [1,2,3,4,5,6,7,8,9,10,11,12], seasons: {
      spring: 'Flocks on the river and in flooded fields in March and April, most heading to big lakes to nest.',
      summer: 'Non-breeding birds loaf in parking lots and on ball fields; few nest anywhere near here.',
      fall: 'Numbers climb in September and October as birds move through along the river.',
      winter: 'Wherever there is open water and a dumpster: the parking-lot gull all winter.' } },
    'Herring Gull': { type: 'resident', months: [1,2,3,4,5,6,7,8,9,10,11,12], seasons: {
      spring: 'Adults head to the coast and big lakes to nest; a few immatures hang on along the river.',
      summer: 'Scarce in the valley; the brown young birds you see are last year\'s.',
      fall: 'More arrive along the river in October and November, mixed with ring-bills.',
      winter: 'The big pale gull below the dams and on the ice, often with a black-backed or two.' } },
  };

  const SEASON_OF = (m) => (m >= 3 && m <= 5) ? 'spring' : (m >= 6 && m <= 8) ? 'summer' : (m >= 9 && m <= 11) ? 'fall' : 'winter';
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const has = (e, m) => e.months.includes(m);
  const wrap = (m) => ((m - 1 + 12) % 12) + 1;
  // the contiguous run of present months (cyclic) that contains m: { first, last, length }
  function run(e, m) {
    let first = m, last = m, n = 1;
    while (n < 12 && has(e, wrap(first - 1))) { first = wrap(first - 1); n++; }
    while (n < 12 && has(e, wrap(last + 1))) { last = wrap(last + 1); n++; }
    return { first, last, length: n };
  }
  // the status word for this month, from type and months only
  function word(e, m) {
    if (e.type === 'resident' || e.months.length >= 12) return 'Here all year';
    if (!has(e, m)) {
      let next = wrap(m + 1); for (let i = 0; i < 12 && !has(e, next); i++) next = wrap(next + 1);
      return 'Gone until ' + MONTHS[next - 1];
    }
    const r = run(e, m);
    if (e.type === 'migrant') {
      if (r.length <= 2) return 'Passing through';
      return m === r.first ? 'Arriving' : m === r.last ? 'Leaving' : 'Peaking';
    }
    if (m === r.first && r.length > 1) return 'Arriving';
    if (m === r.last && r.length > 1) return 'Leaving';
    return e.type === 'winter' ? 'Here for the winter' : 'Here for the summer';
  }
  // DAYBIRD_STATUS.now('White-throated Sparrow', new Date()) → { word, line, season, month, present, type, months }
  function now(name, date) {
    const e = species[name]; if (!e) return null;
    const d = date ? new Date(date) : new Date();
    const m = d.getMonth() + 1, season = SEASON_OF(m);
    return { word: word(e, m), line: e.seasons[season], season, month: m, present: has(e, m), type: e.type, months: e.months.slice() };
  }
  return { species, now, word: (name, m) => species[name] ? word(species[name], m) : null, seasonOf: SEASON_OF, MONTHS, names: () => Object.keys(species) };
})();
