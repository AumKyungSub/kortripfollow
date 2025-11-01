import React from 'react'

import { Link } from 'react-router-dom'

const BannerComponent = ({item}) => {
  return (
    <div>
      <Link to={`/location/${item?.id}`}>
        <img src={item?.imgName+"3.jpg"} alt={item?.imgName+"3.jpg"} />
        <div className="swiper-text01">
            <strong>{item?.location} <span>{item?.locationEnglish}</span></strong>
            <p className="swiper-p01">{item?.explainSide}</p>
        </div>
      </Link>
      
    </div>
  )
}

export default BannerComponent