import React from 'react'

import { Link } from 'react-router-dom'

const TopfiveComponent = ({item}) => {
  return (
        <div className="card">
          <Link to={`/location/${item?.id}`}>
            <img src={item?.imgName+"1.jpg"} alt={item?.imgName+"1.jpg"} />
            <span className='topRanking'>
                TOP {item?.top}
            </span>
            <p>{item?.location}</p>
          </Link>
        </div>
  )
}

export default TopfiveComponent